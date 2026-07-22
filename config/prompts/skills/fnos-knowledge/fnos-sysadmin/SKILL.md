---
name: fnos-sysadmin
description: fnOS 系统管理（网络/安全/备份/存储/用户/全景）与故障排查、OpenList 集成
---

# fnOS 系统管理知识

> 涵盖：系统全景 / 存储结构 / 用户权限 / 网络进阶 / 安全 / 同步备份 / 故障排查 / OpenList 集成
>
> **工具分工**：基础系统查询（版本/CPU/内存/磁盘/日志/应用管理/Docker/文件操作/用户增删/存储池操作）请使用官方 `trim-cli` 对应子命令（trim-system/trim-app/trim-docker/trim-file/trim-log/trim-monitor/trim-storage/trim-user）。本文件专注于 trim-cli 未覆盖的**管理规范、网络配置、安全策略、备份方案与故障排查决策**。

---

# 第一部分：系统全景

## 一、系统定位

fnOS（飞牛私有云）是广州铁刃智造开发的国产 NAS 专用操作系统：

- 基于 **Debian Linux** 深度定制，行为与标准 Debian 有差异
- 支持 x86_64；ARM64 持续适配中
- **存算分离**：系统盘与数据盘独立，重装系统不丢数据
- WEB UI 统一管理，CLI 直接修改系统级配置风险较高
- 持续快速迭代，以当前实际版本为准

## 二、存储结构

### 2.1 核心目录布局

```
/vol1/, /vol2/, /vol<N>/           存储池根目录
/vol1/@appcenter/<appname>/        应用安装目录
/vol1/@appdata/<appname>/          应用持久化数据（升级不覆盖）
/vol1/@apphome/<appname>/data/     应用核心数据（hermes-agent 等）
/vol1/@team/<teamname>/            团队文件夹
/vol1/<uid>/<foldername>/          用户存储文件夹（uid 从 1000 起）
/vol1/<uid>/.@#local/trash/        用户个人回收站（fnOS 私有路径）
/var/apps/<appname>/target/        应用运行路径（@appcenter 软链目标）
/usr/trim/                         fnOS 私有系统组件（只读）
/etc/fnos/                         fnOS 私有配置（禁改）
/etc/docker/daemon.json            Docker 配置（禁止 CLI 直接修改）
```

### 2.2 存算分离与重装

- 系统盘独立（通常 M.2 SSD 或 U 盘），数据盘独立
- 重装系统只格式化系统盘；重装后「存储管理」中重新挂载即可
- 同盘安装时选「只格式化系统分区」
- 硬件迁移：硬盘直接移到新机器，安装系统后挂载

### 2.3 存储管理

存储池/磁盘/SMART 的具体操作命令请使用 `trim-cli storage` 系列子命令。

支持 RAID 类型：JBOD / RAID 1 / RAID 5 / SHR

## 三、用户与权限体系

### 3.1 用户层级

| 层级 | 特征 |
|---|---|
| **超级管理员** | 第一个创建的用户；完整 sudo；默认 SSH；不可删除 |
| **管理员** | 部分 sudo；需手动开启 SSH |
| **普通用户** | 无 sudo/SSH；只能访问授权文件夹；可设配额 |
| **应用用户** | 用户名=appname；沙箱隔离；默认零权限 |

用户增删改操作请使用 `trim-cli user` 系列子命令。**CLI useradd/usermod/userdel 禁止使用**。

### 3.2 文件权限

- fnOS 使用 POSIX ACL 管理（v1.2.0+ 升级为 Windows ACL 模型）
- ACL 查看：`trim-cli file acl get <path>`
- CLI 修改 ACL 可能被 WEB UI 覆盖，建议通过 WEB UI 管理

### 3.3 应用权限（沙箱）

- 默认只能访问自身 `$TRIM_PKGVAR` 目录
- 访问用户文件夹需用户在 WEB UI 中授权
- Docker 权限需在 `privilege` 声明 `join-groups: ["docker"]`

---

# 第二部分：网络配置

## 一、端口规划

| 端口 | 服务 | 备注 |
|---|---|---|
| 5666 | fnOS WEB UI (HTTP) | 系统保留 |
| 5667 | fnOS WEB UI (HTTPS / WS API) | 系统保留 |
| 22 | SSH | 可在 WEB UI 修改 |
| 445 | SMB | 系统保留 |
| 2049 | NFS | 系统保留 |
| 5005/5006 | WebDAV | 系统保留 |

**第三方应用建议端口范围**：18000-19999

## 二、多网卡与链路聚合

```
WEB UI → 设置 → 网络 → 网络接口 → 独立 IP / 链路聚合
聚合模式：
  - 主备模式（Active-Backup）：高可用
  - 802.3ad LACP：需交换机支持，提升带宽
```

## 三、静态 IP 与 DNS

NAS 建议静态 IP（WEB UI → 网络 → 手动配置），或路由器 DHCP 按 MAC 绑定。

推荐 DNS：223.5.5.5（阿里）/ 119.29.29.29（腾讯）/ 1.1.1.1 / 8.8.8.8，主备双配置。

## 四、远程访问方案

| 方案 | 配置路径 | 适用场景 |
|---|---|---|
| fnConnect | WEB UI → 远程访问 → fnConnect | 免费，临时远程 |
| DDNS + 端口转发 | WEB UI → 域名与证书 → DDNS | 有公网 IP |
| 反向代理 | WEB UI → 反向代理 | 统一 HTTPS，隐藏内部端口 |
| VPN (WireGuard) | 应用中心安装 | 全内网访问，无需暴露端口 |

## 五、端口转发安全建议

| 服务 | 外网端口 | 内网端口 | 建议 |
|---|---|---|---|
| fnOS WEB UI | 自定义（如 15667） | 5667 | 避免默认端口 |
| SSH | 自定义（如 22222） | 22 | 必须改端口 |
| 飞牛影视 | 443（反向代理） | 8000 | 走反向代理 |

- 公网暴露端口越少越好，优先 VPN 或反向代理
- SSH 必须修改默认端口

## 六、Wake-on-LAN

前提：主板 BIOS 开启 WOL + 有线网络连接。

```
WEB UI → 设置 → 电源 → 网络唤醒（查看 MAC 地址）
远程唤醒：wakeonlan <NAS_MAC> 或手机 WOL App
```

## 七、常见网络问题

### NAS 无法访问外网

排查顺序：网关 → DNS → 直连 IP → MTU

常见原因：DNS 错误 / 路由器 ACL / MTU 不匹配

### Docker 容器无法访问外网

通过 fnOS Docker 管理 WEB UI 配置 DNS。**不要直接编辑 `/etc/docker/daemon.json`**。

### SMB 连接慢

- 确认同子网；跨网段 SMB 性能差
- 关闭 SMB 签名（家庭环境）：WEB UI → 文件共享 → SMB → 高级
- 使用 SMB3 协议

---

# 第三部分：安全

## 一、SSL 证书

| 类型 | 配置 |
|---|---|
| 自签名（默认） | 安装即有，浏览器警告 |
| Let's Encrypt | WEB UI → 域名与证书 → 申请（需公网域名） |
| 自定义证书 | WEB UI → 导入 .crt + .key |

证书自动应用于 WEB UI / 反向代理 / WebDAV HTTPS。

## 二、SSH 安全加固

- **改端口**：WEB UI → 安全 → SSH → 修改（如 22222）
- **禁用密码登录**：使用 ed25519 密钥认证
- **限制账户**：仅允许必要账户 SSH

```sh
# 查看 SSH 登录日志
journalctl -u ssh -n 50 --no-pager
grep "Failed password" /var/log/auth.log 2>/dev/null | tail -20
```

## 三、防火墙

```
WEB UI → 设置 → 安全 → 防火墙
- 按 IP 段、端口、协议设置允许/拒绝规则
```

**禁止** CLI `iptables -F` 清空规则。紧急封锁 IP：`sudo iptables -A INPUT -s <IP> -j DROP`（临时，重启失效）。

## 四、账户安全

- **密码策略**：WEB UI → 用户管理 → 密码策略
- **2FA**：WEB UI → 个人设置 → 两步验证（TOTP）
- **登录锁定**：WEB UI → 安全 → 账户保护（失败次数 + 锁定时间）

## 五、网络暴露面控制

| 服务 | 建议 |
|---|---|
| WEB UI (5666/5667) | 仅内网，公网用 fnConnect/VPN |
| SSH | 改端口，限信任 IP，或内网+VPN |
| SMB/NFS | 仅内网，禁止公网 |

优先反向代理 + HTTPS，统一走 443，不暴露内部端口。

## 六、数据安全

- **存储加密**：WEB UI → 存储池 → 加密（AES-256），忘记密钥=永久丢失
- **权限最小化**：每个文件夹明确授权用户，避免全员读写
- **回收站**：WEB UI → 文件管理 → 回收站设置，开启自动清理与 SMB 删除进回收站

## 七、安全巡检清单

定期执行（建议每月）：

1. 检查系统版本：`cat /etc/fnos/version`
2. 检查异常登录：`lastb -n 20`
3. 检查监听端口：`ss -tlnp`（有无意外开放）
4. 检查 SUID 文件：`find / -perm -4000 -type f 2>/dev/null | grep -v proc`
5. 检查 crontab：`crontab -l`

## 八、已知安全事件

| 时间 | 事件 | 影响版本 | 修复 |
|---|---|---|---|
| 2026-02 | 路径穿越 RCE | ≤1.1.15 | 1.1.18+ |
| 2026-02 | OTA 升级被木马破坏 | ≤1.1.15 | 1.1.18+ |

版本过低时告知用户立即更新，OTA 失败则从 fnnas.com 下载完整镜像重装。

---

# 第四部分：同步与备份

## 一、备份策略（3-2-1 原则）

```
3 份副本：本机 NAS + 本地另一设备 + 异地/云
2 种介质：NAS 磁盘 + 外置硬盘/云存储
1 份异地：云存储 / 异地 NAS / 外出移动硬盘
```

## 二、rsync 增量备份

```sh
# 本地卷间（安全模式，不同步删除）
rsync -avz /vol1/1000/documents/ /vol2/backup/documents/

# 远程备份
rsync -avz -e "ssh -p 22" /vol1/1000/docs/ admin@远程IP:/vol1/backup/docs/

# 排除 fnOS 私有目录
rsync -avz --exclude='.@#local' --exclude='*.tmp' /vol1/1000/ /vol2/backup/

# 定时备份（crontab -e）
0 2 * * * rsync -az /vol1/1000/documents/ /vol2/backup/documents/ >> /path/to/rsync.log 2>&1
```

常用选项：`-a`归档 `-v`详情 `-z`压缩 `-P`进度+续传 `--delete`同步删除 `--dry-run`模拟 `--bwlimit=KB/s`限速

## 三、fnOS 同步助手

```
WEB UI → 应用中心 → 同步助手
支持：实时/定时同步、本地↔远程、单向/双向、过滤规则
```

**注意**：开启「同步删除」后，源端误删会同步到目标。

## 四、快照

```
WEB UI → 存储 → 快照（需 Btrfs/ZFS 文件系统支持）
特点：秒级恢复、写时复制不占额外空间
```

## 五、备份频率建议

| 数据类型 | 频率 | 方式 |
|---|---|---|
| 工作文档 | 每天 | rsync / 同步助手实时 |
| 照片/视频 | 每周 | rsync + 云备份 |
| 应用数据(@appdata) | 每天 | rsync |
| Docker 卷数据 | 每天 | rsync /vol1/@appdata/ |
| NAS 整体 | 每月 | 完整卷快照 |

## 六、迁移与硬件更换

- **扩容**：WEB UI → 存储池 → 更换磁盘（热插拔）
- **停机迁移**：新卷 rsync → 停服务验证 → 切换路径
- **换硬件**：旧 NAS 备份 @appdata → 硬盘移新机 → 装同版 fnOS → 存储管理导入 → 重装应用

---

# 第五部分：故障排查手册

## 一、排查原则

1. 先只读查询，弄清现状再操作
2. 按层次：网络层 → 系统层 → 应用层 → 数据层
3. fnOS 持续更新，以当前版本实际表现为准
4. 不确定的操作先描述给用户，等待确认

## 二、WEB UI 无法访问

**症状**：浏览器无法打开 `http://<IP>:5666` 或 `https://<IP>:5667`

SSH 排查步骤：
```sh
ss -tlnp | grep -E "5666|5667"       # 端口监听
systemctl status nginx                 # nginx 状态
tail -50 /var/log/nginx/error.log      # nginx 错误
journalctl -n 100 -p err --no-pager   # 系统错误
df -h                                  # 磁盘是否满
```

常见原因：磁盘写满 / 端口被占 / fnOS 服务崩溃 / 防火墙拦截

## 三、SSH 无法连接

常见原因与解决：
- SSH 未开启 → WEB UI → 安全 → SSH 访问
- 用户未授权 → WEB UI → SSH → 选择账户
- 指纹冲突（重装后） → `ssh-keygen -R <NAS_IP>`
- 端口已修改 → 在 WEB UI 查看当前端口

## 四、存储空间告警

```sh
df -h /vol1/                                            # 存储池使用率
du -sh /vol1/*/ 2>/dev/null | sort -rh | head -10       # 一级目录
du -sh /vol1/@appdata/*/ 2>/dev/null | sort -rh         # 各应用数据
find /vol1/ -size +500M -type f 2>/dev/null | head -20  # 大文件
sudo docker system df -v 2>/dev/null                    # Docker 占用
```

快速释放：清空回收站 → Docker `image prune -f` → `container prune -f` → 删应用日志

## 五、应用无法启动

```sh
# 使用 trim-cli 查状态
trim-cli app status <appname>

# 查应用日志
tail -100 /vol1/@appdata/<appname>/logs/*.log 2>/dev/null

# 查端口冲突
ss -tlnp | grep <端口>

# 查数据目录权限
ls -la /vol1/@appdata/<appname>/

# 磁盘空间不足也会导致启动失败
df -h /vol1/
```

## 六、Docker 容器问题

### 容器无法启动/反复重启

```sh
sudo docker logs --tail 50 <container>                    # 退出日志
sudo docker inspect <container> | grep -A3 '"ExitCode"'   # 退出码
```

退出码速查：0=正常 / 1=应用错误 / 137=OOM / 139=段错误 / 143=SIGTERM

### 容器网络不通

```sh
sudo docker exec -it <container> ping 8.8.8.8
sudo docker exec -it <container> nslookup baidu.com
```

### Docker 服务级故障

```sh
systemctl status docker
journalctl -u docker -n 50 --no-pager
# 常见：/etc/docker/daemon.json 被手动修改破坏 → 通过 WEB UI 管理
```

## 七、WS API 连接失败

```sh
ss -tlnp | grep 5667                       # 端口监听
curl -sk https://<NAS_IP>:5667/ | head -20  # HTTPS 连通
```

常见错误码：
- errno 4352 = 权限不足 → 用管理员账户
- errno 4353 = Token 失效 → 重新 connect()

签名要点：timestamp 为整数秒、json.dumps 用 `separators=(',', ':')`、HMAC key 是 secret_bytes。

## 八、回收站问题

### 路径格式

```
个人：/vol<N>/<uid>/.@#local/trash/
团队：/vol<N>/@team/<teamname>/.@#local/trash/
```

### file.rm moveToTrashbin Bug

`file.rm` API 的 `moveToTrashbin: true` 存在已知 Bug：实际永久删除。

正确删除方式：
- 有 API：使用 `file.mv` 移入 `.@#local/trash/`
- 无 API：引导用户在 WEB UI 文件管理器中删除
- SSH `rm`：始终永久删除

### 同名文件命名

删除同名文件：`report.pdf` → `report_1.pdf` → `report_2.pdf`

fnOS 回收站无 `.trashinfo` 文件，原始路径由系统内部维护。

## 九、系统日志定位

```sh
journalctl -n 100 -p err --no-pager                    # 系统错误
journalctl --since "1h ago" --no-pager                  # 最近 1 小时
journalctl -u docker -n 50 --no-pager                  # Docker 服务
journalctl -b --no-pager | grep -i error               # 本次启动
tail -50 /var/log/nginx/error.log                       # nginx 错误
```

日志中心详细操作请使用 `trim-cli logger` 系列子命令。

## 十、系统重置与恢复

### OTA 更新失败

从 fnnas.com 下载完整镜像，USB 引导重装。数据盘不受影响，重装后「存储管理」重新挂载。

### 忘记管理员密码

- 方案 1：接显示器键盘，本地控制台重置
- 方案 2：完整镜像重装（数据不丢失）

### 应用数据损坏

```sh
# 停止应用（使用 trim-cli）
trim-cli app stop <appname> --yes

# 从备份恢复，或删除损坏配置让应用重新初始化
rm /vol1/@appdata/<appname>/config/config.yaml
trim-cli app start <appname> --yes
```

---

# 第六部分：OpenList 文件管理集成

> OpenList 是开源网盘聚合工具，支持本地、阿里云盘、夸克、115 等多种存储后端。
> 本应用不内置 OpenList 操作脚本。如需 AI 驱动文件管理，社区有开源 MCP Server 可供参考。

## 社区方案：openlist-mcp-server

GitHub: https://github.com/hbestm/openlist-mcp-server

社区维护的 MCP Server，提供 79 个工具覆盖 OpenList 全部功能。**非本应用提供，安装配置需用户自行完成。**

### 功能概览

| 分类 | 能力 |
|---|---|
| 浏览与搜索 | 目录列表、文件信息、递归搜索 |
| 文件管理 | 创建/重命名/移动/复制/删除（含批量和正则） |
| 传输 | 上传（本地/base64/URL）、下载直链 |
| 分享 | 创建/修改/删除分享链接（密码+过期） |
| 任务管理 | 离线下载、异步任务重试/取消 |
| 管理员 | 存储挂载、驱动管理、系统设置、索引维护 |
| 高级 | 磁盘分析、重复文件、解压、Torrent |

### 安装参考

```bash
git clone https://github.com/hbestm/openlist-mcp-server.git
cd openlist-mcp-server
python3 -m venv venv && source venv/bin/activate
pip install -e .
```

### Hermes Agent 接入配置

```yaml
mcp_servers:
  openlist:
    command: /path/to/openlist-mcp-server/venv/bin/python
    args: ["-m", "openlist_mcp"]
    env:
      OPENLIST_URL: "http://<OpenList地址>:5244"
      OPENLIST_USERNAME: "<用户名>"
      OPENLIST_PASSWORD: "<密码>"
```

配置后执行 `hermes gateway restart` 生效。具体参数参阅项目 README。

## 未安装 MCP Server 时

引导用户通过 OpenList Web UI 手动操作：

| 操作 | 路径 |
|---|---|
| 浏览文件 | 首页 → 选择存储 → 浏览目录 |
| 上传文件 | 进入目标目录 → 上传按钮 |
| 创建分享 | 选中文件 → 分享 → 设密码和有效期 |
| 管理存储 | 管理 → 存储 → 添加/编辑驱动 |
| 重建索引 | 管理 → 索引 → 重建 |
