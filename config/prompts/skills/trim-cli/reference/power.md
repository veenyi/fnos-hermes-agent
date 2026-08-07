# Power Reference

电源模块用于重启或关闭 NAS。两条命令都会中断当前设备服务和 CLI 连接，执行前必须确认目标地址、当前账号权限和业务影响。

## Commands

| Command | Endpoint | Effect |
| --- | --- | --- |
| `trim-cli power reboot --yes` | `power.reboot` | 请求重启 NAS |
| `trim-cli power poweroff --yes` | `power.poweroff` | 请求关闭 NAS |

## Confirmation

默认会弹出交互确认。自动化场景或已经确认目标设备时传 `--yes` 跳过提示。

```
trim-cli --host <host> --port <port> power reboot --yes
trim-cli --host <host> --port <port> power poweroff --yes
```

## Session Requirements

执行前需要已经登录并保存 session。CLI 会使用保存的 session 完成签名认证后发送电源请求。

## Output

命令成功发送并被后端接受后输出简短成功信息：

```
Reboot request accepted
Poweroff request accepted
```

后端接受请求通常表示重启或关机已经被安排，不表示设备已经完成重启或已经完全断电。
