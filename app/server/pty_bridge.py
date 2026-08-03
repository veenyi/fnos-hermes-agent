#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PTY 代理：为 monitor.js 的 /api/terminal/ws 提供真正的伪终端。

背景：monitor 原实现用 child_process.spawn("/bin/bash", ["-i"], {stdio:"pipe"})
启动交互 shell。bash -i 在无 TTY 时打印:
    bash: cannot set terminal process group (N): Inappropriate ioctl for device
    bash: no job control in this shell
且 Ctrl+C / 前后台任务全部失效。

本脚本用 Python 标准库 pty.fork() 创建真实 PTY：子进程自动成为会话首领并
获得控制终端（setsid + TIOCSCTTY），因此 job control / 信号 / 全屏程序全部
正常。父进程负责 PTY master fd <-> stdin/stdout 双向转发。

控制帧协议（从 stdin 读取，与用户输入区分）：
    \x1b[HERMES1\x1bRESIZE\x1b{rows};{cols}\x1b[HERMES2
    \x1b[HERMES1\x1bPING\x1b[HERMES2        → 回写 PONG
用法：
    python3 pty_bridge.py [--shell SHELL] [--cwd DIR] [--login]
"""
import argparse
import ctypes
import errno
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

# ── 控制帧分隔符 ──────────────────────────────────────────────────────
_CTRL_HEAD = b"\x1b[HERMES1\x1b"
_CTRL_TAIL = b"\x1b[HERMES2"

_TERM_DEFAULT = "xterm-256color"

# 全局句柄：供 SIGHUP 处理器关闭 PTY master，触发子 shell 退出
_master_fd = -1
_child_pid = 0


def _handle_hup(signum, frame):
    """前端断开（monitor 发 SIGHUP）：关闭 PTY master + SIGTERM 子 shell。"""
    _log("SIGHUP received, tearing down PTY")
    if _child_pid > 0:
        try:
            os.kill(_child_pid, signal.SIGTERM)
        except OSError:
            pass
    if _master_fd > 0:
        try:
            os.close(_master_fd)
        except OSError:
            pass


def _log(msg: str) -> None:
    try:
        sys.stderr.write("[pty_bridge] " + msg + "\n")
        sys.stderr.flush()
    except Exception:
        pass


def _set_winsize(fd: int, rows: int, cols: int) -> None:
    rows = max(2, min(int(rows or 0) or 24, 32767))
    cols = max(2, min(int(cols or 0) or 80, 32767))
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    except OSError:
        pass


def _set_nonblock(fd: int) -> None:
    flags = fcntl.fcntl(fd, fcntl.F_GETFL, 0)
    fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)


def _handle_ctrl_frame(buf: bytes, master_fd: int, child: int) -> bool:
    """处理一个完整控制帧，返回 True 表示已消费。"""
    if not buf.startswith(_CTRL_HEAD):
        return False
    body = buf[len(_CTRL_HEAD):]
    tail = body.find(_CTRL_TAIL)
    if tail < 0:
        return False  # 帧不完整，等下一次
    payload = body[:tail]
    if payload.startswith(b"RESIZE\x1b"):
        try:
            rc = payload[len(b"RESIZE\x1b"):].split(b";")
            rows, cols = int(rc[0]), int(rc[1])
            _set_winsize(master_fd, rows, cols)
            if child > 0:
                try:
                    os.kill(child, signal.SIGWINCH)
                except OSError:
                    pass
        except Exception:
            pass
    elif payload == b"PING":
        try:
            os.write(1, b"PONG\n")
        except OSError:
            pass
    return True


def _process_stdin_data(data: bytes, ctrl_buf: bytes, master_fd: int, child: int):
    """解析 stdin 数据中的控制帧，返回 (剩余 ctrl_buf, 应转发给 master 的用户输入)。

    注意：控制帧与用户输入可能在同一块数据里（pipe 合并写入），
    解析完控制帧后必须把剩余内容转发给 PTY，否则首批命令会丢失。
    """
    ctrl_buf += data
    leftover = b""
    while True:
        head = ctrl_buf.find(_CTRL_HEAD)
        if head < 0:
            # 无控制帧头：全部是用户输入
            leftover += ctrl_buf
            ctrl_buf = b""
            break
        if head > 0:
            leftover += ctrl_buf[:head]
        tail = ctrl_buf.find(_CTRL_TAIL, head)
        if tail < 0:
            # 帧不完整：保留待后续数据拼齐（head 前内容已提取转发）
            ctrl_buf = ctrl_buf[head:]
            break
        _handle_ctrl_frame(ctrl_buf[head:tail + len(_CTRL_TAIL)], master_fd, child)
        ctrl_buf = ctrl_buf[tail + len(_CTRL_TAIL):]
    return ctrl_buf, leftover


def main() -> int:
    ap = argparse.ArgumentParser(description="PTY bridge for monitor terminal")
    ap.add_argument("--shell", default="/bin/bash")
    ap.add_argument("--cwd", default=None)
    ap.add_argument("--login", action="store_true")
    args = ap.parse_args()

    shell = args.shell
    if args.login:
        argv = [shell, "--login", "-i"]
    else:
        argv = [shell, "-i"]

    cwd = args.cwd or os.environ.get("HOME") or "/"
    if not os.path.isdir(cwd):
        try:
            os.makedirs(cwd, exist_ok=True)
        except OSError:
            cwd = os.environ.get("HOME") or "/"

    env = os.environ.copy()
    env["TERM"] = env.get("TERM") or _TERM_DEFAULT
    env.setdefault("LANG", "C.UTF-8")
    env.setdefault("COLORTERM", "truecolor")
    if "PS1" not in env:
        env["PS1"] = "\\u@\\h:\\w\\$ "

    # 初始尺寸（与主流 80x24 一致；前端连接后会用 RESIZE 帧校正）
    master, slave = pty.openpty()
    _set_winsize(slave, 24, 80)

    _log(f"spawning {argv} cwd={cwd}")

    pid = os.fork()
    if pid == 0:
        # 父进程死亡（含 SIGKILL）时自动终止 shell：PR_SET_PDEATHSIG = SIGTERM
        try:
            ctypes.CDLL(None).prctl(1, signal.SIGTERM, 0, 0, 0)
        except Exception:
            pass
        # 子进程：成为会话首领并获取控制终端
        os.setsid()
        try:
            fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
        except OSError:
            pass
        try:
            os.dup2(slave, 0)
            os.dup2(slave, 1)
            os.dup2(slave, 2)
        finally:
            if slave > 2:
                os.close(slave)
            if master > 2:
                os.close(master)
        os.chdir(cwd)
        os.execvpe(argv[0], argv, env)

    # 父进程：关闭不需要的 slave fd
    os.close(slave)
    global _master_fd, _child_pid
    _master_fd = master
    _child_pid = pid
    signal.signal(signal.SIGHUP, _handle_hup)
    _set_nonblock(master)
    _set_nonblock(0)

    # 主循环：master <-> stdin(0) 双向转发，stdin 解析控制帧
    ctrl_buf = b""
    alive = True
    while alive:
        try:
            rlist, _, _ = select.select([master, 0], [], [], 0.5)
        except (OSError, ValueError):
            break
        if master in rlist:
            try:
                data = os.read(master, 65536)
            except OSError as exc:
                if exc.errno in (errno.EIO, errno.EBADF):
                    break  # 子进程退出，PTY 关闭
                if exc.errno == errno.EAGAIN:
                    data = b""
                else:
                    break
            if not data:
                break
            try:
                os.write(1, data)
            except OSError:
                break
        if 0 in rlist:
            try:
                data = os.read(0, 65536)
            except OSError as exc:
                if exc.errno in (errno.EIO, errno.EBADF, errno.EAGAIN):
                    data = b""
                else:
                    break
            if not data:
                # stdin EOF = 前端断开，终止 shell
                break
            if _CTRL_HEAD in data or ctrl_buf:
                # 含控制帧：解析帧后剩余部分转发给 PTY（不能丢弃！）
                ctrl_buf, leftover = _process_stdin_data(data, ctrl_buf, master, pid)
                if leftover:
                    try:
                        os.write(master, leftover)
                    except OSError:
                        break
            else:
                try:
                    os.write(master, data)
                except OSError:
                    break
        # 子进程退出检测
        try:
            wpid, status = os.waitpid(pid, os.WNOHANG)
            if wpid == pid:
                alive = False
        except ChildProcessError:
            alive = False
        except OSError:
            pass

    # 子进程已退出/前端断开：补一次收割，避免僵尸
    try:
        os.waitpid(pid, 0)
    except (ChildProcessError, OSError):
        pass
    try:
        os.close(master)
    except OSError:
        pass
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
