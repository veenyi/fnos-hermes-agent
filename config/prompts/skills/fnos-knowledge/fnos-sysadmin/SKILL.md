---
name: fnos-sysadmin
description: fnOS 系统架构、存储、用户权限、CLI 命令、网络、安全、备份等系统管理员视角的完整知识库。在 fnOS NAS 上做运维、配置或故障排查时加载。
---

# fnOS 系统管理知识

> 涵盖：系统架构 / 存储 / 用户权限 / CLI 命令 / 网络进阶 / 安全 / 同步备份

---

# 第一部分：系统全景

---

## 一、系统定位与特点

fnOS（飞牛私有云）是广州铁刃智造开发的国产 NAS 专用操作系统：

- 基于 **Debian Linux** 深度定制，但行为与标准 Debian 有大量差异
- 支持 x86_64 架构；ARM64 持续适配中（功能可能有差异）
- **存算分离**：系统盘与数据盘独立，重装系统不丢数据
- 持续快速迭代，遇到行为与本文件不符时，以当前实际版本为准
- WEB UI 统一管理大部分系统功能，CLI 直接操作系统级配置风险较高

---

## 二、存储结构

### 2.1 存储池与目录

```
/vol1/                              第一个存储池根目录
/vol2/                              第二个存储池（多盘扩展时）
/vol<N>/                            第 N 个存储池

/vol1/@appcenter/                   应用安装目录（应用中心统一管理）
/vol1/@appcenter/<appname>/         各应用安装根
/vol1/@appdata/                     应用持久化数据（升级不覆盖）
/vol1/@appdata/<appname>/           各应用数据目录
/vol1/@team/                        团队文件夹
/vol1/@team/<teamname>/             各团队文件夹

/var/apps/<appname>/target/         应用实际运行路径（@appcenter 的软链目标）
/usr/trim/                          fnOS 私有系统组件（只读，禁止修改）
/etc/fnos/                          fnOS 私有配置（禁止修改）
/etc/docker/daemon.json             Docker 配置（禁止 CLI 直接修改）
```

### 2.2 用户存储文件夹

```
/vol1/<uid>/<foldername>/           用户存储文件夹
/vol1/<uid>/.@#local/trash/         用户个人回收站（fnOS 私有路径）
```

- uid 从 1000 开始（fnOS 第一个用户 uid=1000）
- 用户的「文件夹」在 WEB UI 文件管理器中创建，可选存储空间
- 不同存储池的文件夹在 WEB UI 统一显示，在 SSH 中路径不同（/vol1/ vs /vol2/）

### 2.3 存储管理

```
WEB UI → 存储 → 存储管理
查看存储池状态、磁盘健康、RAID 状态、存储空间使用

支持的 RAID 类型（取决于磁盘数量）：
- JBOD（无冗余，多盘合并）
- RAID 1（镜像，2 盘）
- RAID 5（奇偶校验，3 盘以上）
- SHR（Synology 混合 RAID 兼容模式）
```

**磁盘健康检查**：
```
WEB UI → 存储 → 磁盘管理 → 选择磁盘 → S.M.A.R.T. 检测
```

### 2.4 存算分离与重装

- 系统安装在独立系统盘（通常是 M.2 SSD 或 U 盘）
- 数据盘独立，重装系统只格式化系统盘
- 如果系统盘和数据盘在同一硬盘：安装时选「只格式化系统分区」
- 重装后在「存储管理」中重新挂载数据盘，数据完整保留
- 迁移硬件：直接将硬盘移到新机器，重新安装系统并挂载

---

## 三、用户与权限体系

### 3.1 用户层级

| 层级 | 特征 |
|---|---|
| **超级管理员** | fnOS 第一个创建的用户；完整 sudo；默认 SSH；不可删除 |
| **管理员** | 后续创建的管理员；部分 sudo；需手动开启 SSH |
| **普通用户** | 无 sudo、无 SSH；只能访问授权文件夹；可设配额 |
| **应用用户** | 用户名 = appname（无 @ 前缀）；沙箱隔离；默认零权限 |

### 3.2 用户管理（仅 WEB UI）

```
WEB UI → 设置 → 用户管理
- 创建/删除/修改用户
- 分配存储文件夹权限
- 设置存储配额
- 管理用户组
```

**CLI useradd/usermod/userdel 禁止使用**，会破坏 fnOS 用户体系。

### 3.3 文件权限

fnOS 使用 POSIX ACL 管理文件权限：
```
WEB UI → 文件管理器 → 右键文件夹 → 权限设置
可设置：读取 / 读写 / 完全控制 / 拒绝
```

CLI 查看 ACL：
```sh
getfacl /vol1/1000/shared/
```

CLI 修改 ACL 可能被 WEB UI 刷新覆盖，建议通过 WEB UI 管理。

### 3.4 应用权限

每个 .fpk 应用有独立沙箱：
- 默认只能访问自身 `$TRIM_PKGVAR` 目录
- 访问用户存储文件夹需用户在 WEB UI 中授权
- 需要 docker 命令权限需在 `privilege` 中声明 `join-groups: ["docker"]`

---

## 四、CLI 命令速查

### 4.1 系统状态

```sh
# fnOS 版本
cat /etc/fnos/version 2>/dev/null
cat /etc/os-release | grep -E "^(NAME|VERSION)"

# 系统资源
df -h                              # 所有挂载点
df -h /vol1/                       # fnOS 存储池
free -h                            # 内存
uptime                             # 系统负载
nproc                              # CPU 核心数
cat /proc/cpuinfo | grep "model name" | head -1  # CPU 型号

# 进程
ps aux --sort=-%cpu | head -15     # CPU 占用 TOP
ps aux --sort=-%mem | head -15     # 内存占用 TOP

# 磁盘详情
lsblk -f                           # 块设备
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT  # 简洁格式
du -sh /vol1/*/                    # 各目录大小（包含应用数据）
du -sh /vol1/@appdata/*/           # 各应用数据大小

# 日志
journalctl -n 100 -p err --no-pager   # 最近错误
journalctl --since "1h ago" --no-pager  # 最近 1 小时
journalctl -f                          # 实时追踪

# 服务（只读查询）
systemctl status <service>         # 单个服务状态
systemctl list-units --type=service --state=failed  # 失败的服务
```

### 4.2 网络

```sh
ip addr                            # 网卡 IP（替代 ifconfig）
ip route                           # 路由表
ss -tlnp                           # TCP 监听端口
ss -ulnp                           # UDP 监听端口
ping -c 3 8.8.8.8                  # 外网连通
curl -sk https://localhost:5667/   # WEB UI 本地连通
```

### 4.3 应用管理（appcenter-cli）

```sh
# 只读查询
appcenter-cli list                     # 已安装应用列表（含状态）
appcenter-cli info <appname>           # 应用详细信息
appcenter-cli status <appname>         # 运行状态（0=运行，3=停止）

# 控制
appcenter-cli start <appname>          # 启动
appcenter-cli stop <appname>           # 停止
appcenter-cli restart <appname>        # 重启

# 本地安装
appcenter-cli install-local enable     # 首次启用本地安装
appcenter-cli install-fpk /path/to.fpk  # 安装本地 .fpk
appcenter-cli default-volume 1         # 设置默认安装存储卷

# 卸载（高风险）
appcenter-cli uninstall --keep-data <appname>   # 卸载保留数据
appcenter-cli uninstall <appname>               # 卸载删除数据
```

`appcenter-cli` 命令随 fnOS 版本更新可能变化，遇到不存在的子命令先执行 `appcenter-cli --help`。

### 4.4 包管理

fnOS 基于 Debian，apt 可用，但安装额外软件包可能影响系统稳定性：
```sh
sudo apt update && sudo apt list --upgradable  # 查看可更新包
sudo apt install <package>                      # 安装
```

常用工具（通常已预装）：`curl` `wget` `vim` `htop` `rsync` `unzip`

---

## 五、网络与远程访问

### 5.1 端口规划

| 端口 | 服务 | 备注 |
|---|---|---|
| 5666 | fnOS WEB UI (HTTP) | 系统保留 |
| 5667 | fnOS WEB UI (HTTPS / WS API) | 系统保留 |
| 22 | SSH | 可在 WEB UI 修改端口 |
| 445 | SMB 文件共享 | 系统保留 |
| 2049 | NFS 共享 | 系统保留 |
| 5005/5006 | WebDAV | 系统保留 |
| 8000 | 飞牛影视 | 默认，可修改 |
| 8123 | Home Assistant（若安装） | 参考 |

**第三方应用建议端口范围**：18000-19999（冲突风险低）

### 5.2 SSH 配置

```
WEB UI → 设置 → 安全 → SSH 访问
- 开启/关闭 SSH
- 选择可 SSH 登录的账户
- 修改 SSH 端口（修改后需用新端口连接）
```

默认：超级管理员账户 SSH 默认开启，普通/管理员账户需手动启用。

```sh
# 用户本机连接
ssh admin@192.168.1.100
ssh -p 2222 admin@192.168.1.100    # 自定义端口
```

### 5.3 远程访问方案

**fnConnect（官方）**：
```
WEB UI → 设置 → 远程访问 → fnConnect
免费服务，流量有限，适合临时远程访问
```

**DDNS + 端口转发**：
```
WEB UI → 设置 → 域名与证书 → 自定义域名
需要在路由器设置端口转发：外网端口 → NAS 5666/5667
```

**反向代理**：
```
WEB UI → 设置 → 反向代理
可为内网服务配置域名，通过 HTTPS 访问
```

---

## 六、文件共享服务

### 6.1 SMB（Windows 文件共享）

```
WEB UI → 设置 → 文件共享 → SMB
启用后 Windows 可在「网络位置」找到 NAS
路径：\\<NAS_IP>\ 或 \\<NAS_名称>\
账号：fnOS 用户名/密码
```

SMB 删除偏好：
```
WEB UI → 设置 → 文件管理 → 删除偏好
开启：SMB 删除 → 进入回收站（推荐）
关闭：SMB 删除 → 直接永久删除
```

**注意**：SSH `rm` 命令无论如何设置，始终直接永久删除（不进回收站）。

### 6.2 WebDAV

```
WEB UI → 设置 → 文件共享 → WebDAV
端口：5005（HTTP）/ 5006（HTTPS）
用途：支持 WebDAV 的客户端、文件管理器、备份软件
```

### 6.3 NFS（Linux 客户端）

```
WEB UI → 设置 → 文件共享 → NFS
用途：Linux/macOS 客户端挂载，适合内网高性能传输
```

### 6.4 FTP / SFTP

```
WEB UI → 设置 → 文件共享 → FTP
SFTP 使用 SSH 端口（22），无需额外配置，启用 SSH 后即可使用
```

---

## 七、应用中心

### 7.1 应用安装

```
WEB UI → 应用中心 → 搜索/分类浏览 → 安装
```

**官方应用**（fnOS 深度集成）：
- 飞牛影视：媒体管理与播放（端口 8000）
- 相册：照片管理与 AI 分类
- Docker 管理：图形化容器管理
- 同步助手：多设备文件同步
- 虚拟机：KVM 虚拟化管理
- 文件管理器：WEB UI 文件操作
- 备份：数据备份与快照

### 7.2 本地 .fpk 安装

```sh
# 步骤 1：启用本地安装（首次）
appcenter-cli install-local enable

# 步骤 2：上传并安装
scp app.fpk admin@<NAS_IP>:/tmp/
appcenter-cli install-fpk /tmp/app.fpk
```

### 7.3 应用数据与升级

- 应用数据存于 `/vol1/@appdata/<appname>/`，升级时保留
- 升级操作在 WEB UI → 应用中心 → 已安装 → 更新
- 应用配置文件建议放在 `$TRIM_PKGVAR` 目录，而非应用安装目录（升级会覆盖）

---

## 八、媒体功能（飞牛影视）

```
访问：http://<NAS_IP>:8000
功能：
- 电影/剧集/音乐/照片 整理与播放
- 海报自动抓取（刮削）
- 移动端 / WEB 端 / 电视端 播放
- 硬件解码（取决于 CPU/GPU）

媒体库路径：在 WEB UI 中添加媒体库时选择文件夹
建议目录结构：
  /vol1/1000/movies/          电影
  /vol1/1000/tvshows/         剧集
  /vol1/1000/music/           音乐
```

---

## 九、虚拟机

```
WEB UI → 应用中心 → 虚拟机（需要安装虚拟机应用）
基于 KVM，支持 Windows / Linux 虚拟机
需要 CPU 支持虚拟化（Intel VT-x / AMD-V）
```

---

## 十、系统更新

```
WEB UI 更新（推荐）：设置 → 系统更新 → 检查更新
手动更新（OTA 失败时）：从 fnnas.com 下载完整镜像，USB 引导安装
```

查看当前版本：
```sh
cat /etc/fnos/version 2>/dev/null
cat /etc/os-release
```

**OTA 失败情况**：若 OTA 更新失败导致系统不稳定，用完整镜像重装，数据盘数据不影响。

---

## 十一、日志体系

| 日志 | 路径 |
|---|---|
| 系统日志 | `journalctl`（systemd journal）|
| fnOS 应用日志 | `/vol1/@appdata/<appname>/` 下（如 `hermes.log`、`info.log`）|
| Nginx 访问日志 | `/var/log/nginx/access.log` |
| Nginx 错误日志 | `/var/log/nginx/error.log` |
| Docker 容器日志 | `sudo docker logs <container>` |

---
---

# 第二部分：网络进阶

> 涵盖：多网卡 / VLAN / 链路聚合 / Wake-on-LAN / DDNS / 反向代理 / UPS

---

## 一、多网卡配置

### 1.1 独立 IP 模式

每块网卡配置独立 IP，用于隔离不同网络：

```
WEB UI → 设置 → 网络 → 网络接口
→ 选择网卡 → 配置 IP（静态 / DHCP）
```

### 1.2 链路聚合（Bond）

多块网卡合并，提升带宽或冗余：

```
WEB UI → 设置 → 网络 → 链路聚合 → 新建
模式选择：
  - 主备模式（Active-Backup）：一块故障自动切换，适合高可用
  - 负载均衡（802.3ad LACP）：需要交换机支持，提升带宽
```

**注意**：802.3ad 需要交换机开启 LACP，否则选主备模式。

### 1.3 查看当前网络状态

```sh
ip addr                          # 所有网卡 IP
ip link                          # 网卡状态（UP/DOWN）
ip route                         # 路由表
cat /proc/net/bonding/bond0      # 链路聚合状态（如有）
ethtool eth0                     # 网卡速率和连接状态
```

---

## 二、静态 IP 配置建议

NAS 建议配置静态 IP，防止 DHCP 分配变化导致连接失败：

```
WEB UI → 设置 → 网络 → 选择网卡 → 手动配置
填写：IP 地址 / 子网掩码 / 网关 / DNS
```

或在路由器 DHCP 中按 MAC 地址绑定固定 IP（DHCP 静态绑定）：
```sh
# 查看 MAC 地址
ip link show | grep "link/ether"
```

---

## 三、DNS 配置

```
WEB UI → 设置 → 网络 → DNS
推荐 DNS：
  国内：223.5.5.5（阿里）/ 119.29.29.29（腾讯）
  国际：1.1.1.1（Cloudflare）/ 8.8.8.8（Google）
  建议配置两个，主备冗余
```

测试 DNS 解析：
```sh
nslookup baidu.com
nslookup registry-1.docker.io    # Docker Hub 解析测试
dig baidu.com 2>/dev/null         # 更详细的 DNS 查询（如已安装）
```

---

## 四、DDNS（动态 DNS）

公网 IP 会变化时，通过 DDNS 维持固定域名：

```
WEB UI → 设置 → 域名与证书 → DDNS
支持服务商：Cloudflare / 阿里云 DNS / 腾讯 DNSPod 等（取决于版本）
配置：填入域名、API Key、更新间隔
```

验证 DDNS 生效：
```sh
ping your.domain.com             # 确认解析到当前公网 IP
curl ifconfig.me                 # 查看当前公网 IP
```

---

## 五、反向代理

将内网服务通过域名对外暴露，统一走 HTTPS，不暴露内部端口：

```
WEB UI → 设置 → 反向代理 → 新建规则
配置项：
  来源域名：app.yourdomain.com
  目标：http://localhost:8000（内网服务地址）
  HTTPS：开启（需要 SSL 证书）
  WebSocket：按需开启
```

**常见用途**：
- 飞牛影视对外访问（避免暴露 8000 端口）
- Hermes Agent WEB UI 对外访问
- 任何内网 Docker 服务

---

## 六、Wake-on-LAN（网络唤醒）

远程开机，适合平时关机省电、需要时远程唤醒：

**前提**：
- 主板 BIOS 开启 WOL 功能
- 连接有线网络（无线网卡通常不支持 WOL）

```
WEB UI → 设置 → 电源 → 网络唤醒
查看 NAS 的 MAC 地址，记录备用
```

从其他设备唤醒：
```sh
# Linux/macOS
wakeonlan <NAS_MAC>              # 需安装 wakeonlan 工具
# 或
etherwake <NAS_MAC>

# 手机 App：搜索「WOL」「Wake on LAN」均可
```

---

## 七、端口转发配置指引

NAS 需要从公网访问时，在路由器配置端口转发：

| 服务 | 外网端口 | 内网端口 | 备注 |
|---|---|---|---|
| fnOS WEB UI | 自定义（如 15667） | 5667 | 避免使用默认端口 |
| SSH | 自定义（如 22222） | 22 | 必须改端口 |
| 飞牛影视 | 443（反向代理） | 8000 | 建议走反向代理 |

**安全建议**：
- 公网暴露端口越少越好
- 优先使用反向代理或 VPN，而非直接暴露端口
- SSH 必须修改默认端口

---

## 八、网络诊断命令

```sh
# 基础连通
ping -c 4 8.8.8.8                     # 外网连通
ping -c 4 192.168.1.1                 # 网关连通
traceroute 8.8.8.8 2>/dev/null        # 路由追踪

# 端口测试
ss -tlnp                              # 本机监听端口
nc -zv 192.168.1.100 5667             # 测试远程端口（需安装 netcat）
curl -sk https://192.168.1.100:5667/  # HTTPS 连通

# 带宽测试（需要 iperf3）
iperf3 -s                             # NAS 作为服务端
iperf3 -c 192.168.1.100               # 客户端测试（另一台机器执行）

# 网络流量实时监控
nethogs 2>/dev/null                    # 按进程查看流量（需安装）
iftop 2>/dev/null                      # 按连接查看流量（需安装）
cat /proc/net/dev                      # 原始流量计数器
```

---

## 九、常见网络问题

### NAS 无法访问外网

```sh
# 1. 测试网关
ping -c 3 $(ip route | grep default | awk '{print $3}')

# 2. 测试 DNS
nslookup baidu.com 223.5.5.5

# 3. 测试直连 IP（绕过 DNS）
curl -I http://223.5.5.5

# 常见原因
# - DNS 配置错误 → 改为 223.5.5.5
# - 路由器 ACL 拦截 → 检查路由器设置
# - MTU 不匹配 → ip link set eth0 mtu 1400（临时测试）
```

### Docker 容器无法访问外网

```sh
# 测试容器 DNS
sudo docker exec <container> nslookup baidu.com

# 配置 Docker DNS（通过 fnOS Docker 管理 WEB UI 配置）
# 不要直接编辑 /etc/docker/daemon.json
```

### SMB 连接慢

- 检查是否在同一子网（跨网段 SMB 性能差）
- 关闭 SMB 签名（家庭环境可关闭提升速度）：WEB UI → 文件共享 → SMB → 高级设置
- 检查客户端 SMB 版本（建议使用 SMB3）

---
---

# 第三部分：安全知识

> 涵盖：SSL 证书 / SSH 安全 / 防火墙 / 账户安全 / 已知漏洞 / 安全加固

---

## 一、SSL 证书管理

### 1.1 自签名证书（默认）

fnOS 安装后默认使用自签名证书，浏览器会显示「不安全」警告。
访问 `https://<NAS_IP>:5667` 时点击「继续访问」即可正常使用。

### 1.2 申请 Let's Encrypt 免费证书

**前提**：NAS 有公网访问域名，且 80/443 端口可被外网访问（或使用 DNS 验证）。

```
WEB UI → 设置 → 域名与证书 → 申请证书
→ 选择 Let's Encrypt
→ 填写域名（需已解析到公网 IP）
→ 验证方式：HTTP 验证 或 DNS 验证
→ 申请成功后自动续期
```

### 1.3 导入自定义证书

```
WEB UI → 设置 → 域名与证书 → 导入证书
→ 上传 .crt 证书文件和 .key 私钥文件
→ 支持通配符证书（*.yourdomain.com）
```

### 1.4 证书应用范围

证书配置后自动应用于：
- fnOS WEB UI（5666/5667）
- 反向代理的 HTTPS 服务
- WebDAV HTTPS（5006）

---

## 二、SSH 安全

### 2.1 SSH 基础配置

```
WEB UI → 设置 → 安全 → SSH 访问
- 开启/关闭 SSH
- 修改 SSH 端口（建议改为非 22 端口减少扫描）
- 选择允许 SSH 登录的账户（不建议开放所有用户）
```

### 2.2 SSH 安全加固建议

**修改默认端口**（减少自动化扫描攻击）：
```
WEB UI → 安全 → SSH → 修改端口（如 22222）
修改后连接方式：ssh -p 22222 admin@<NAS_IP>
```

**禁用密码登录，使用密钥认证**（更高安全性）：
```sh
# 在用户本机生成密钥对
ssh-keygen -t ed25519 -C "fnos-admin"

# 上传公钥到 NAS
ssh-copy-id -p <ssh_port> admin@<NAS_IP>
# 或手动将 ~/.ssh/id_ed25519.pub 内容追加到 NAS 的 ~/.ssh/authorized_keys
```

**查看 SSH 登录日志**：
```sh
journalctl -u ssh -n 50 --no-pager
grep "Failed password" /var/log/auth.log 2>/dev/null | tail -20
grep "Accepted" /var/log/auth.log 2>/dev/null | tail -20
```

---

## 三、防火墙

### 3.1 fnOS 内置防火墙

```
WEB UI → 设置 → 安全 → 防火墙
- 开启/关闭防火墙
- 添加允许/拒绝规则
- 按 IP 段、端口、协议设置规则
```

**注意**：不要通过 CLI `iptables -F` 清空规则，会导致防火墙策略丢失且影响系统服务。

### 3.2 查看当前防火墙状态（只读）

```sh
sudo iptables -L -n -v         # 查看 iptables 规则
sudo iptables -L INPUT -n      # 查看入站规则
```

### 3.3 临时封锁 IP（紧急情况，WEB UI 无法访问时）

```sh
# 临时封锁（重启后失效，仅紧急使用）
sudo iptables -A INPUT -s <恶意IP> -j DROP

# 永久配置通过 WEB UI → 防火墙 → 添加黑名单规则
```

---

## 四、账户安全

### 4.1 密码策略

```
WEB UI → 设置 → 用户管理 → 密码策略
- 最小长度
- 复杂度要求
- 定期修改提醒
```

### 4.2 双因素认证（2FA）

```
WEB UI → 个人设置 → 安全 → 两步验证
支持：TOTP（Google Authenticator / Authy 等）
建议：管理员账户强制启用 2FA
```

### 4.3 登录失败锁定

```
WEB UI → 设置 → 安全 → 账户保护
- 连续失败次数上限
- 锁定时间
- IP 黑名单
```

### 4.4 查看登录日志

```sh
# 系统登录日志
last -n 20                     # 最近登录记录
lastb -n 20                    # 最近失败登录
journalctl -n 50 | grep -i "login\|auth\|ssh"
```

---

## 五、网络暴露面控制

### 5.1 最小化端口暴露

仅开放必要端口到公网，其余限制内网访问：

| 服务 | 建议 |
|---|---|
| fnOS WEB UI (5666/5667) | 仅内网，公网用 fnConnect 或 VPN |
| SSH (22) | 改端口，仅信任 IP 段，或内网 + VPN |
| SMB (445) | 仅内网，禁止公网 |
| NFS (2049) | 仅内网 |
| 飞牛影视 (8000) | 可公网，建议加密和登录保护 |

### 5.2 反向代理代替直接端口暴露

```
WEB UI → 设置 → 反向代理 → 新建规则
→ 为内部服务配置子域名
→ 统一走 443 HTTPS，不暴露内部端口
→ 配合 Let's Encrypt 证书使用
```

### 5.3 VPN 方案

```
WEB UI → 应用中心 → 搜索 VPN 或 WireGuard
推荐：WireGuard（性能好，配置简单）
用途：远程访问 NAS 的所有内网服务，无需暴露任何端口
```

---

## 六、数据安全

### 6.1 存储加密

```
WEB UI → 存储 → 存储池 → 加密设置
支持对存储池加密（AES-256）
加密后断电需要密钥才能挂载
注意：忘记加密密钥 = 数据永久丢失，务必备份密钥
```

### 6.2 共享文件夹权限最小化

```
WEB UI → 文件管理 → 共享文件夹 → 权限设置
- 每个文件夹明确指定可访问用户
- 避免全员可读写
- 敏感数据独立文件夹，单独控制权限
```

### 6.3 回收站作为数据保护层

删除文件进回收站可防止误删：
```
WEB UI → 设置 → 文件管理 → 回收站设置
- 开启自动清理（如 30 天后自动清空）
- 开启 SMB 删除进回收站（默认可能关闭）
```

---

## 七、已知安全事件记录

| 时间 | 事件 | 影响版本 | 修复 |
|---|---|---|---|
| 2026-02 | 路径穿越 RCE 漏洞 | ≤1.1.15 | 1.1.18+ |
| 2026-02 | OTA 升级被木马破坏（需完整镜像重装） | ≤1.1.15 | 1.1.18+ |

**检查版本**：
```sh
cat /etc/fnos/version 2>/dev/null
```

发现版本过低时的告知话术：
```
⚠️ 检测到您的 fnOS 版本较低（当前：x.x.x）
建议立即更新：fnOS 桌面 → 设置 → 系统更新
若 OTA 失败，请从 fnnas.com/download 下载完整镜像重装
（重装不影响存储池数据）
```

---

## 八、安全巡检清单

定期（建议每月）执行：

```sh
# 1. 检查系统版本
cat /etc/fnos/version

# 2. 检查异常登录
lastb -n 20
journalctl --since "7 days ago" | grep -i "failed\|invalid" | wc -l

# 3. 检查监听端口（有无意外开放）
ss -tlnp

# 4. 检查高权限文件（SUID）
find / -perm -4000 -type f 2>/dev/null | grep -v proc

# 5. 检查 crontab（有无可疑任务）
crontab -l 2>/dev/null
ls -la /etc/cron* 2>/dev/null
```

---
---

# 第四部分：同步与备份

> 涵盖：同步助手 / rsync / 快照 / 云备份 / 迁移 / 3-2-1 策略

---

## 一、fnOS 同步助手

### 1.1 功能说明

```
WEB UI → 应用中心 → 同步助手
功能：
- 多设备间文件夹实时/定时同步
- 支持本地 NAS ↔ 远程 NAS 同步
- 单向同步（备份）或双向同步
- 支持文件过滤规则（排除特定类型）
```

### 1.2 同步任务配置

```
同步助手 → 新建任务
→ 选择源目录（本地文件夹）
→ 选择目标（本地其他卷 / 远程 fnOS / SFTP）
→ 同步模式：实时 / 定时
→ 冲突处理：源优先 / 目标优先 / 保留两份
→ 是否同步删除（谨慎：开启后源删除会同步到目标）
```

**注意**：「同步删除」功能开启后，源端误删文件会导致目标端同步删除，需谨慎。

### 1.3 同步日志查看

```
WEB UI → 同步任务 → 任务详情 → 日志
或
ls -la /vol1/@appdata/<同步应用名>/logs/ 2>/dev/null
```

---

## 二、rsync 手动备份

rsync 是最可靠的增量备份工具，fnOS 通常预装。

### 2.1 本地卷间备份

```sh
# 单次增量备份（-a 保留权限，-v 显示进度，-z 压缩，--delete 同步删除）
rsync -avz /vol1/1000/documents/ /vol2/backup/documents/

# 不同步删除（更安全，目标只增不删）
rsync -avz /vol1/1000/documents/ /vol2/backup/documents/ --no-delete

# 排除特定目录
rsync -avz --exclude='.@#local' --exclude='*.tmp' \
    /vol1/1000/ /vol2/backup/1000/
```

### 2.2 远程备份（SSH）

```sh
# 备份到远程服务器/另一台 NAS
rsync -avz -e "ssh -p 22" \
    /vol1/1000/documents/ \
    admin@192.168.1.200:/vol1/backup/documents/

# 自定义 SSH 端口
rsync -avz -e "ssh -p 2222" \
    /vol1/1000/photos/ \
    admin@backup-nas.local:/vol1/photos_backup/
```

### 2.3 定时备份（crontab）

```sh
# 编辑 crontab
crontab -e

# 每天凌晨 2 点备份
0 2 * * * rsync -az /vol1/1000/documents/ /vol2/backup/documents/ >> /vol1/@apphome/hermes-agent/data/logs/rsync.log 2>&1

# 每周日凌晨 3 点全量备份
0 3 * * 0 rsync -az --delete /vol1/1000/ /vol2/weekly_backup/ >> /vol1/@apphome/hermes-agent/data/logs/rsync_weekly.log 2>&1
```

### 2.4 rsync 常用选项速查

| 选项 | 说明 |
|---|---|
| `-a` | 归档模式（保留权限/时间/软链接） |
| `-v` | 显示传输文件列表 |
| `-z` | 传输时压缩（适合慢速网络） |
| `-P` | 显示进度 + 断点续传 |
| `--delete` | 删除目标中源端不存在的文件 |
| `--dry-run` | 模拟执行，不实际操作（测试用） |
| `--exclude='pattern'` | 排除匹配的文件/目录 |
| `--bwlimit=1000` | 限速（KB/s） |

---

## 三、快照功能

```
WEB UI → 存储 → 快照（取决于文件系统和版本支持）
```

快照是存储层的时间点副本，可快速恢复到某个时间点：
- 恢复速度极快（秒级）
- 不占用额外存储空间（写时复制）
- 依赖文件系统支持（Btrfs / ZFS）

```sh
# 查看当前文件系统类型
df -T /vol1/
lsblk -f | grep vol
```

若文件系统支持快照，可在 WEB UI → 存储 → 快照 中配置自动快照计划。

---

## 四、多机同步（fnOS ↔ fnOS）

适合家庭多台 NAS 或办公室与家庭同步：

```
方案 1：fnOS 同步助手（图形化，简单）
→ 两台 fnOS 均安装同步助手
→ 配置 SFTP 连接
→ 设置同步规则

方案 2：rsync over SSH（灵活，适合精细控制）
→ 目标 NAS 开启 SSH
→ 源 NAS 配置 SSH 密钥免密登录
→ crontab 定时执行 rsync
```

---

## 五、备份策略建议

### 5.1 3-2-1 原则

```
3 份数据副本
  本机 NAS（主数据）
  本地另一台设备或另一块硬盘（本地备份）
  异地/云（远程备份）

2 种存储介质
  NAS 磁盘 + 外置硬盘 / NAS + 云存储

1 份异地
  云存储 / 异地 NAS / 定期外出的移动硬盘
```

### 5.2 不同数据的备份频率建议

| 数据类型 | 建议频率 | 方式 |
|---|---|---|
| 工作文档 | 每天 | rsync 定时 / 同步助手实时 |
| 照片/视频 | 每周 | rsync + 云备份 |
| 系统配置 | 每次修改后 | 手动导出 |
| Docker 卷数据 | 每天 | rsync /vol1/@appdata/ |
| NAS 整体 | 每月 | 完整卷快照 |

### 5.3 应用数据备份

fnOS 应用数据集中在 `/vol1/@appdata/`，是备份重点：

```sh
# 备份所有应用数据
rsync -avz /vol1/@appdata/ /vol2/appdata_backup/ --exclude='*.log' --exclude='*.pid'

# 只备份 Hermes Agent 数据
rsync -avz /vol1/@appdata/hermes-agent/ /vol2/backup/hermes-agent/
```

---

## 六、迁移与硬件更换

### 6.1 更换更大的硬盘

```
方案 A（停机迁移）：
1. 新硬盘格式化后挂载为新卷 /vol2/
2. rsync 全量数据到新卷
3. 停止所有服务，验证数据完整
4. 修改应用指向新路径（或交换挂载点）

方案 B（存储扩容，如 RAID/SHR 支持）：
WEB UI → 存储 → 存储池 → 更换磁盘（热插拔扩容）
```

### 6.2 迁移到新 NAS 硬件

```
1. 在旧 NAS 上完整备份 /vol1/@appdata/（应用数据）
2. 将所有硬盘迁移到新机器
3. 在新机器安装相同版本 fnOS
4. 存储管理中导入现有存储池
5. 应用数据自动恢复（在 @appdata 目录中）
6. 重新安装应用（@appcenter 不迁移，重新安装即可）
```

