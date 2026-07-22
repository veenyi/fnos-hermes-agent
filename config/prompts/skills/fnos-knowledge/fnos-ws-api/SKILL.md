---
name: fnos-ws-api
description: 飞牛 NAS WebSocket API（端口 5667）的完整调用指南：认证、权限、命名空间、错误码、文件/存储/Docker 接口。需要以编程方式调用 fnOS 后端 API 时加载。注意：必须使用 NAS 真实内网 IP，不能用 127.0.0.1。
---

# fnOS Skill

飞牛 NAS (FnOS) WebSocket API 完整调用指南。Agent 根据以下流程自行编写调用代码，不提供独立脚本。

---

## 一、连接信息

> ⚠️ **重要：必须使用真实的 NAS IP 地址，不要使用 `127.0.0.1`！**
>
> `127.0.0.1:5667` 是本地反向代理/负载均衡器（nginx），它会返回 `{"errno": null, "result": "succ"}` 但**不执行真正的认证**，登录请求会被静默丢弃，导致始终 errno=131089。
>
> 必须使用 NAS 的真实内网 IP，例如 `192.168.1.100:5667`。在 Docker 容器/虚拟机环境中运行时尤其需要注意，`localhost` 映射到的是反向代理而非真正的 NAS 服务。

```
WebSocket:  wss://<NAS_HOST>:5667/websocket?type=main
HTTPS 上传: https://<NAS_HOST>:5667/upload
```

> NAS 使用自签名证书，SSL 验证需关闭（`check_hostname=False`, `verify_mode=ssl.CERT_NONE`）。

---

## 二、用户类型与权限

FnOS 用户分为**管理员**和**普通用户**两类，权限差异显著：

| 能力 | 管理员 | 普通用户 |
|---|---|---|
| Docker / 容器管理 | ✅ 有 | ❌ 无 |
| 应用中心（安装/卸载应用） | ✅ 有 | ❌ 无，只能看管理员安装的应用 |
| 存储卷管理（stor.*） | ✅ 有 | ❌ 无（返回权限不足 4352） |
| 系统监控（appcgi.resmon.*） | ✅ 有 | ❌ 无（返回权限不足 4352） |
| 文件读写（file.*） | ✅ 有 | ✅ 有（限本人目录 `vol{stor_id}/{uid}/*`） |
| 用户管理（user.*） | ✅ 有 | ❌ 无 |
| 回收站（file.trash.*） | ✅ 有 | ✅ 有（限本人目录） |

**实际影响**：
- 普通用户（`admin=false`）**无法使用 Docker**，无法通过 WebUI 安装应用
- 普通用户可以查看管理员安装的应用，但无法自行安装或卸载
- `appcgi.*` 系列接口（系统监控、进程管理等）**仅管理员可用**，普通用户调用返回 `errno: 4352 权限不足`
- `stor.*` 系列接口（存储卷列表、磁盘健康等）**仅管理员可用**
- 文件操作 `file.*` 普通用户可正常使用，路径限制在 `vol{stor_id}/{uid}/*` 下

> 调用前可通过 `user.login` 响应中的 `admin` 字段判断当前用户是否为管理员。

---

## 三、认证流程

共 4 步，完成后得到 `token`、`secret_bytes`（HMAC 密钥）和 `backId`，后续所有请求都要用 `secret_bytes` 签名。

### 第 1 步：连接 WebSocket 并获取 RSA 公钥

```python
import websockets, json, ssl, asyncio

ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE

ws = await websockets.connect(
    'wss://<NAS_HOST>:5667/websocket?type=main',
    ping_interval=None, ssl=ssl_ctx
)

await ws.send(json.dumps({'req': 'util.crypto.getRSAPub', 'reqid': '6819e1ca00000000000000000001'}))
resp = json.loads(await ws.recv())
pub = resp['pub']   # RSA 公钥
si  = resp['si']    # 服务器标识
```

### 第 2 步：加密登录数据并发送

```python
import os, base64, json, random
from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_v1_5, AES
from Crypto.Util.Padding import pad

# 生成随机 AES 密钥和 IV
key = ''.join(random.choice('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ') for _ in range(32))
iv   = os.urandom(16)

# RSA 加密 AES 密钥
rsa_key = RSA.import_key(pub)
cipher  = PKCS1_v1_5.new(rsa_key)
rsa_encrypted = base64.b64encode(cipher.encrypt(key.encode())).decode()

# AES 加密登录 JSON
login_json = json.dumps({
    "req": "user.login", "reqid": "6819e1ca00000000000000000002",
    "user": "<USERNAME>", "password": "<PASSWORD>",
    "deviceType": "Browser", "deviceName": "Windows-Google Chrome",
    "stay": False, "si": si
}, separators=(',', ':'))

aes_cipher = AES.new(key.encode(), AES.MODE_CBC, iv)
aes_encrypted = base64.b64encode(aes_cipher.encrypt(pad(login_json.encode(), AES.block_size))).decode()

enc = {
    'req': 'encrypted',
    'iv':  base64.b64encode(iv).decode(),
    'rsa': rsa_encrypted,
    'aes': aes_encrypted
}
await ws.send(json.dumps(enc, separators=(',', ':')))
login_resp = json.loads(await ws.recv())
```

### 第 3 步：解析登录响应

```python
token   = login_resp['token']          # HTTP 上传时需要
secret  = login_resp['secret']         # AES 加密的签名密钥
backId  = login_resp['backId']         # 后续签名用
uid     = login_resp['uid']            # 用户 ID
admin   = login_resp['admin']          # 是否管理员
```

### 第 4 步：AES 解密 secret 得到 HMAC 密钥

```python
from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad

aes_cipher = AES.new(key.encode(), AES.MODE_CBC, iv)
secret_b64   = base64.b64encode(unpad(aes_cipher.decrypt(base64.b64decode(secret)), AES.block_size)).decode()
secret_bytes = base64.b64decode(secret_b64)   # 这是 HMAC 签名密钥的原始字节
```

---

## 四、签名机制

登录后除登录请求本身外，所有请求都需要 HMAC-SHA256 签名。

```python
import hmac, hashlib, base64, json, time

_index = 1
def get_reqid(backId='0000000000000000'):
    global _index
    t = format(int(time.time()), 'x').zfill(8)
    e = format(_index, 'x').zfill(4)
    _index += 1
    return f"{t}{backId}{e}"

def sign(data: dict, secret_bytes: bytes, backId: str) -> str:
    data = dict(data)
    data['reqid'] = get_reqid(backId)
    json_str = json.dumps(data, separators=(',', ':'))
    sig = base64.b64encode(
        hmac.new(secret_bytes, json_str.encode(), hashlib.sha256).digest()
    ).decode()
    return sig + json_str
```

**无需签名的请求**（已在白名单）：
- `encrypted`（登录加密请求）
- `util.getSI`
- `util.crypto.getRSAPub`

---

## 五、常用 API 详解

### 5.1 user.info —— 获取用户信息

**请求：**
```python
await ws.send(sign({"req": "user.info"}, secret_bytes, backId))
resp = json.loads(await ws.recv())
```

**响应示例：**
```json
{
  "userInfo": {
    "user": "<USERNAME>",
    "uid": 1003,
    "comment": "<USERNAME>",
    "email": "",
    "mobile": "",
    "groups": ["Users"],
    "disableUser": 0,
    "lastChange": 20620
  },
  "result": "succ"
}
```

---

### 5.2 stor.getUserStorage —— 获取存储信息

**请求：**
```python
await ws.send(sign({
    "req": "stor.getUserStorage",
    "quotaInfo": True, "spaceInfo": True, "storInfo": True
}, secret_bytes, backId))
resp = json.loads(await ws.recv())
```

**响应示例：**
```json
{
  "stor": [
    {
      "id": 1,
      "comment": "ssd",
      "frsize": 474953453568,
      "fssize": 498429427712,
      "level": "basic",
      "fstype": "btrfs",
      "diskType": "SSD",
      "quotaCurr": 0,
      "quotaMax": -1
    },
    {
      "id": 2,
      "comment": "hdd",
      "frsize": 1643703840768,
      "fssize": 1998709604352,
      "level": "basic",
      "fstype": "btrfs",
      "diskType": "HDD",
      "quotaCurr": 16384,
      "quotaMax": -1
    }
  ],
  "uid": 1003,
  "result": "succ"
}
```

字段说明：`frsize`=总容量，`fssize`=可用容量（字节），`diskType`=SSD/HDD，`id`=stor_id（1=SSD, 2=HDD）

---

### 5.3 appcgi.resmon.gen —— 系统状态总览

**请求：**
```python
await ws.send(sign({"req": "appcgi.resmon.gen"}, secret_bytes, backId))
resp = json.loads(await ws.recv())
```

**响应示例：**
```json
{
  "data": {
    "cpu": { "name": "Intel(R) N150", "num": 1, "core": 4, "thread": 4, "maxFreq": 3600, "temp": [36], ... },
    "mem": { "total": 17179869184, "used": 3863744512, "available": 12665372672, ... },
    "disk": { "num": 3, "disk": [...] }
  }
}
```

---


### 5.4 appcgi.resmon.cpu —— CPU 详情


**请求：**
```python
await ws.send(sign({"req": "appcgi.resmon.cpu"}, secret_bytes, backId))
resp = json.loads(await ws.recv())
```

**响应示例：**
```json
{
  "data": {
    "cpu": {
      "name": "Intel(R) N150",
      "num": 1, "core": 4, "thread": 4,
      "maxFreq": 3600,
      "temp": [36],
      "busy": { "all": 2, "user": 1, "system": 1, "iowait": 23, "other": 0 },
      "loadavg": { "avg1min": 0.20, "avg5min": 0.28, "avg15min": 0.25 },
      "fan": { "fanSpeed": 1155 }
    }
  }
}
```

字段说明：`temp`=CPU 温度(℃)，`busy.all`=总利用率(%)，`loadavg`=系统负载均值


---

### 5.5 appcgi.resmon.mem —— 内存详情

**请求：**
```python
await ws.send(sign({"req": "appcgi.resmon.mem"}, secret_bytes, backId))
resp = json.loads(await ws.recv())
```


**响应示例：**
```json
{
  "data": {
    "mem": {
      "total": 17179869184,
      "used": 3863744512,
      "free": 172621824,
      "available": 12665372672,
      "cached": 12477251584,
      "buffers": 279969792
    },
    "swap": { "total": 0, "free": 0, "used": 0 }
  }
}
```

字段说明：单位为字节，1GB ≈ 10⁹ bytes。`available`=实际可用内存，`cached`=缓存占用

---


### 5.6 appcgi.resmon.disk —— 磁盘 I/O

**请求：**
```python
await ws.send(sign({"req": "appcgi.resmon.disk"}, secret_bytes, backId))
resp = json.loads(await ws.recv())
```


**响应示例：**
```json
{
  "data": {
    "num": 3,
    "disk": [
      {"name": "sda", "temp": 0, "standby": false, "busy": 0, "read": 0, "write": 0},
      {"name": "sdb", "temp": 0, "standby": false, "busy": 0, "read": 0, "write": 0},
      {"name": "nvme0n1", "temp": 0, "standby": false, "busy": 0, "read": 0, "write": 0}
    ]
  }
}
```

字段说明：`temp`=磁盘温度，`busy`= busy 率(%)，`read`/`write`=I/O 速率

---

### 5.7 appcgi.network.net.list —— 网络接口列表

**请求：**
```python
await ws.send(sign({"req": "appcgi.network.net.list"}, secret_bytes, backId))
resp = json.loads(await ws.recv())
```


**响应示例：**
```json
{
  "data": {
    "net": {
      "ifs": [
        {
          "name": "enp2s0",
          "ipv4Addr": "192.168.1.100",
          "ipv4Mask": "255.255.255.0",
          "ipv4Gateway": "192.168.2.1",
          "speed": 5000,
          "running": true,
          "hwAddr": "78:55:36:08:7C:23"
        }
      ]
    }
  }
}
```

字段说明：`speed`=协商速率(Mbps)，`running`=是否在线，`hwAddr`=MAC 地址

---


### 5.8 appcgi.filestor.getSysPartInfo —— 系统盘信息

**请求：**
```python
await ws.send(sign({"req": "appcgi.filestor.getSysPartInfo"}, secret_bytes, backId))
resp = json.loads(await ws.recv())
```

**响应示例：**
```json
{
  "data": {
    "fssize": 104032362496,
    "frsize": 94027759616,
    "type": "SSD"
  }
}
```

字段说明：`fssize`=系统盘总容量，`frsize`=可用空间（字节），`type`=盘类型

---

### 5.9 file.ls —— 文件列表

**请求：**
```python
# 用户根目录
await ws.send(sign({"req": "file.ls", "path": None}, secret_bytes, backId))
# 指定目录
await ws.send(sign({"req": "file.ls", "path": "vol2/1003/openclaw"}, secret_bytes, backId))
resp = json.loads(await ws.recv())
```

**响应示例：**
```json
{
  "files": [
    {
      "name": "test.txt",
      "uid": 1003,
      "size": 1024,
      "mtim": 1762967182,
      "btim": 1762967152,
      "dir": 1
    },
    {
      "name": "demo.txt",
      "uid": 1003,
      "size": 256,
      "mtim": 1762967100,
      "btim": 1762967100
    }
  ],
  "uver": 115537670504450,
  "result": "succ"
}
```
`dir: 1` 表示文件夹，无此字段为文件。

---

### 5.10 file.mkdir —— 创建文件夹

**请求：**
```python
await ws.send(sign({
    "req": "file.mkdir",
    "path": "vol2/1003/openclaw/backup"
}, secret_bytes, backId))
resp = json.loads(await ws.recv())
```

**响应：**
```json
{"result": "succ", "reqid": "6a31184c6a31184c000000510003"}
```

路径格式：`vol{stor_id}/{uid}/{子路径}`，stor_id：1=SSD，2=HDD

---

### 5.11 file.rm —— 删除文件/文件夹

> ⚠️ **Bug预警**：`moveToTrashbin=True` 在返回 `result: 'succ'`（同步删除）时**被服务器忽略**，文件直接永久删除，不会进回收站。推荐用下面的 workaround。

**请求：**
```python
# 直接删除（不经过回收站）
await ws.send(sign({
    "req": "file.rm",
    "files": ["vol2/1003/openclaw/test.txt"],
    "moveToTrashbin": False
}, secret_bytes, backId))
resp = json.loads(await ws.recv())
# 返回: {"result": "succ", "reqid": "..."}

```

**推荐：先移动到临时目录（模拟回收站）再删除——**
```python
# Step 1: 把要删除的文件移动到 "待删除临时目录"
temp_trash = "vol2/1003/.@trash_pending"
await ws.send(sign({
    "req": "file.mv",
    "files": ["vol2/1003/openclaw/test.txt"],
    "destination": temp_trash
}, secret_bytes, backId))
resp = json.loads(await ws.recv())
# 返回: {"result": "succ", "reqid": "..."}

# Step 2: 再从临时目录彻底删除（moveToTrashbin=False 即可）
await ws.send(sign({
    "req": "file.rm",
    "files": [f"{temp_trash}/test.txt"],
    "moveToTrashbin": False
}, secret_bytes, backId))
resp = json.loads(await ws.recv())
# 返回: {"result": "succ", "reqid": "..."}
```

**回收站结构与重命名规则：**

删除文件时，回收站保持与原路径完全相同的目录结构：
```
原路径: vol2/1003/openclaw/test.txt
回收站: vol2/1003/openclaw/test.txt
```

**同名冲突处理规则：**

当回收站中已存在同名文件，再次删除时：
- **文件**：自动重命名为 `原名_序号.扩展名`，序号从 1 开始递增
  - 例: `test.txt` → `test_1.txt` → `test_2.txt`
  - 例: `doc.pdf` → `doc_1.pdf` → `doc_2.pdf`
- **目录**：目录本身**不重命名**，递归处理目录内每个文件（文件按上述规则重命名后移入同名目录）

```
回收站已有 test.txt，再删除 test.txt
→ 新文件被重命名为 test_1.txt 后，再移入回收站

回收站已有 mydir/ 目录，再删除 mydir/
→ 目录名保持 mydir/
→ 目录内文件按同名冲突规则处理后移入 mydir/
```

**回收站 API：**
```python
# 列出回收站内容（路径格式: vol<num>/<uid>，与用户 uid 对应）
await ws.send(sign({
    "req": "file.trash.list",
    "path": "vol2/1003/openclaw"
}, secret_bytes, backId))
resp = json.loads(await ws.recv())
# files[] 每项: {"name": "文件名", "type": "file"/"directory"}

# 从回收站恢复文件到原位置
await ws.send(sign({
    "req": "file.trash.restore",
    "files": ["vol2/1003/openclaw/test.txt"],
    "destination": "vol2/1003/openclaw"
}, secret_bytes, backId))
resp = json.loads(await ws.recv())

# 清空回收站
await ws.send(sign({
    "req": "file.trash.clear",
    "path": "vol2/1003/openclaw"
}, secret_bytes, backId))
resp = json.loads(await ws.recv())

# 搜索回收站文件
await ws.send(sign({
    "req": "appcgi.finder.trashSearch",
    "key": "test",
    "uid": 1003
}, secret_bytes, backId))
resp = json.loads(await ws.recv())
# files[]: [{"name": "test.txt", "path": "...", ...}]
```

---

### 5.12 appcgi.finder.fileSearch —— 搜索文件

**请求：**
```python
await ws.send(sign({
    "req": "appcgi.finder.fileSearch",
    "key": "test",
    "path": ["vol2/1003/openclaw"]
}, secret_bytes, backId))
resp = json.loads(await ws.recv())
```

**响应：**
```json
{"result": "succ", "files": [...], "reqid": "..."}
```

---

### 5.13 file.checkUpload —— 文件上传（第1步）

**请求：**
```python
await ws.send(sign({
    "req": "file.checkUpload",
    "size": 1024,
    "path": "vol2/1003/openclaw/test.txt",
    "overwrite": 2
}, secret_bytes, backId))
resp = json.loads(await ws.recv())
```

**响应：**
```json
{"uploadName": "test.txt.~#0", "result": "succ"}
```

`overwrite`：0=跳过 1=覆盖 2=保留两者（默认）

---

### 5.14 HTTPS 上传 —— 文件上传（第2步）

**请求：**
```python
import requests, hmac, hashlib, base64

upload_name = resp['uploadName']   # checkUpload 返回的文件名
folder     = "vol2/1003/openclaw"
trim_path  = f"{folder}/{upload_name}"

sig = base64.b64encode(
    hmac.new(secret_bytes, trim_path.encode(), hashlib.sha256).digest()
).decode()

headers = {
    'Referer':        f'https://<NAS_HOST>:5667/',
    'Trim-Overwrite': '2',
    'Trim-Token':     token,               # 登录响应中的 token
    'Trim-Mtim':      str(int(os.path.getmtime(local_path))),
    'Trim-Path':      trim_path,
    'Trim-Sign':      sig,
}
with open(local_path, 'rb') as f:
    files = {"trim-upload-file": (filename, f, mime or "application/octet-stream")}
    r = requests.post(
        f'https://<NAS_HOST>:5667/upload',
        headers=headers, files=files, verify=False
    )
# r.status_code == 200 即成功
```

---

## 六、路径格式

```
vol{stor_id}/{uid}/{子路径}
```

| stor_id | 存储 |
|---------|------|
| 1 | SSD |
| 2 | HDD |

uid 从 `user.info` → `userInfo.uid` 获取。

---

## 七、reqid 生成规则

```
格式: {timestamp_hex}{backId}{index_hex}
示例: 6a31195a6a31195a0000005c0003

timestamp: 8位16进制时间戳
backId:    登录响应中的 backId（16位16进制）
index:     4位16进制递增计数器（每次请求+1）
```

---

## 八、心跳机制

```python
# 每 60 秒发送一次
await ws.send(json.dumps({"req": "ping"}))
# 服务端不回复 pong，靠发送维持连接
```

---

## 九、错误码速查

| errno | 说明 |
|-------|------|
| 65534 | 验签失败——secret 未 AES 解密，或签名算法错误 |
| 131072 | 用户名或密码错误 |
| 4224 | 没有登录 |
| 4352 | 权限不足 |
| 4100 | 文件或目录不存在 |
| 4102 | 文件或目录已存在 |
| 4101 | 无效的文件名或路径 |
| 8192 | 参数错误 |
| 100000002 | 参数错误 |
| 100000006 | 服务器开小差，请稍后重试 |
| 131073 | 用户名不存在 |
| 135168 | 无效的凭证 |
| 4386 | 可用容量不足 |
| 4128 | I/O错误 |

---

## 十、完整代码模板

```python
import asyncio, json, os, ssl, sys, base64, hmac, hashlib, time, random
import websockets, requests
from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_v1_5, AES
from Crypto.Util.Padding import pad, unpad

# ── 配置 ──────────────────────────────────────────────
NAS_HOST  = '192.168.1.4'
USERNAME  = 'your_username'
PASSWORD  = 'your_password'
SSL_VERIFY = False

# ── 加密工具 ─────────────────────────────────────────
def generate_random_string(length):
    chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    return ''.join(random.choice(chars) for _ in range(length))

def rsa_encrypt(public_key_str, plaintext):
    key = RSA.import_key(public_key_str)
    return base64.b64encode(PKCS1_v1_5.new(key).encrypt(plaintext.encode())).decode()

def aes_encrypt(data, key, iv):
    return base64.b64encode(AES.new(key.encode(), AES.MODE_CBC, iv).encrypt(pad(data.encode(), AES.block_size))).decode()

def aes_decrypt(ciphertext_b64, key, iv):
    return base64.b64encode(unpad(AES.new(key.encode(), AES.MODE_CBC, iv).decrypt(base64.b64decode(ciphertext_b64)), AES.block_size)).decode()

# ── reqid 生成 ───────────────────────────────────────
_index = 1
def get_reqid(backId='0000000000000000'):
    global _index
    t = format(int(time.time()), 'x').zfill(8)
    e = format(_index, 'x').zfill(4)
    _index += 1
    return f"{t}{backId}{e}"

# ── 签名 ─────────────────────────────────────────────
def sign(data, secret_bytes, backId):
    data = dict(data)
    data['reqid'] = get_reqid(backId)
    json_str = json.dumps(data, separators=(',', ':'))
    sig = base64.b64encode(hmac.new(secret_bytes, json_str.encode(), hashlib.sha256).digest()).decode()
    return sig + json_str

# ── 认证 ─────────────────────────────────────────────
async def fnos_connect(host, username, password, ssl_verify=False):
    ssl_ctx = ssl.create_default_context()
    if not ssl_verify:
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_NONE

    ws = await websockets.connect(
        f'wss://{host}:5667/websocket?type=main',
        ping_interval=None, ssl=ssl_ctx
    )

    # 获取 RSA 公钥
    await ws.send(json.dumps({'req': 'util.crypto.getRSAPub', 'reqid': get_reqid()}))
    resp = json.loads(await ws.recv())
    pub, si = resp['pub'], resp['si']

    # 加密登录
    key = generate_random_string(32)
    iv  = os.urandom(16)
    login_json = json.dumps({
        "req": "user.login", "reqid": get_reqid(),
        "user": username, "password": password,
        "deviceType": "Browser", "deviceName": "Windows-Google Chrome",
        "stay": False, "si": si
    }, separators=(',', ':'))

    enc = {
        'req': 'encrypted',
        'iv':  base64.b64encode(iv).decode(),
        'rsa': rsa_encrypt(pub, key),
        'aes': aes_encrypt(login_json, key, iv)
    }
    await ws.send(json.dumps(enc, separators=(',', ':')))
    login_resp = json.loads(await ws.recv())

    # 解密 HMAC 密钥
    secret_b64   = aes_decrypt(login_resp['secret'], key, iv)
    secret_bytes = base64.b64decode(secret_b64)
    backId = login_resp.get('backId', '0000000000000000')

    return ws, login_resp['token'], secret_bytes, backId

# ── 发送签名请求 ─────────────────────────────────────
async def fnos_call(ws, req, secret_bytes, backId, data=None):
    req_data = {"req": req}
    if data:
        req_data.update(data)
    await ws.send(sign(req_data, secret_bytes, backId))
    resp = json.loads(await ws.recv())
    if resp.get('result') != 'succ' and resp.get('errno'):
        raise Exception(f"[{resp['errno']}] API error")
    return resp

# ── 使用示例 ─────────────────────────────────────────
async def main():
    ws, token, secret_bytes, backId = await fnos_connect(NAS_HOST, USERNAME, PASSWORD)

    # 用户信息
    ui = await fnos_call(ws, 'user.info', secret_bytes, backId)
    print(f"用户: {ui['userInfo']['user']}, UID: {ui['userInfo']['uid']}")

    # 存储信息
    st = await fnos_call(ws, 'stor.getUserStorage', secret_bytes, backId,
                         data={"quotaInfo": True, "spaceInfo": True, "storInfo": True})
    for s in st['stor']:
        print(f"  {s['comment']} ({s['diskType']}): {s['frsize']/1024**3:.1f}GB")

    # 文件列表
    fl = await fnos_call(ws, 'file.ls', secret_bytes, backId, data={"path": "vol2/1003/openclaw"})
    for f in fl.get('files', []):
        print(f"  {'📁' if f.get('dir') else '📄'} {f['name']}")

    # 创建文件夹
    await fnos_call(ws, 'file.mkdir', secret_bytes, backId,
                    data={"path": "vol2/1003/openclaw/backup"})

    await ws.close()

asyncio.run(main())
```

---

## 十一、API 清单总表

> 以下为 FnOS 支持的全部 WebSocket API，按功能分类。`appcgi.*` 为前端调用接口，`file.*`/`stor.*`/`user.*` 等为底层文件/存储/用户接口。
> ⚠️ 标记 `【需管理员】` 的接口普通用户调用返回 `权限不足 (4352)`。

### 文件存储（file.*）

| API | 说明 |
|-----|------|
| file.ls | 列出目录文件 |
| file.lsDir | 列出目录详情（含子目录） |
| file.mkdir | 创建目录 |
| file.rm | 删除文件/文件夹（同名进回收站时自动重命名 `name_N.ext`，目录内文件递归处理，见 4.11） |
| file.mv | 移动/重命名文件 |
| file.cp | 复制文件 |
| file.rename | 重命名文件 |
| file.chown | 修改所有者 |
| file.getAcl | 获取权限 ACL |
| file.setAcl | 设置权限 ACL |
| file.access | 测试文件访问权限 |
| file.prop | 获取文件属性 |
| file.size | 获取文件大小 |
| file.calc | 计算目录大小 |
| file.checkUpload | 文件上传（第1步：申请上传令牌） |
| file.download | 文件下载 |
| file.compress | 压缩文件 |
| file.extract | 解压文件 |
| file.cancel | 取消上传/下载任务 |
| file.share.add | 创建分享链接 |
| file.share.del | 删除分享链接 |
| file.share.info | 分享详情 |
| file.share.list | 列出我的分享 |
| file.share.listOthers | 列出他人分享给我的 |
| file.trash.list | 列出回收站文件（路径格式：`vol<N>/<uid>`） |
| file.trash.restore | 从回收站恢复文件 |
| file.trash.clear | 清空回收站 |
| file.fav.list | 收藏列表 |
| file.fav.add | 添加收藏 |
| file.fav.del | 删除收藏 |
| file.recent.list | 最近访问列表 |
| file.recent.add | 添加最近访问记录 |
| file.recent.del | 删除最近访问记录 |
| file.recent.clear | 清空最近访问记录 |
| file.team.lsDir | 团队存储目录列表 |
| file.usage | 用户存储使用量 |

### 存储管理（stor.*）

| API | 说明 | 权限 |
|-----|------|------|
| stor.listStor | 列出所有存储卷 | 【需管理员】 |
| stor.state | 存储卷状态 | 【需管理员】 |
| stor.listDisk | 列出磁盘 | 【需管理员】 |
| stor.diskHealth | 磁盘健康状态 | 【需管理员】 |
| stor.diskSmart | 磁盘 SMART 信息 | 【需管理员】 |
| stor.format | 格式化磁盘 | 【需管理员】 |
| stor.mount | 挂载存储 | 【需管理员】 |
| stor.umount | 卸载存储 | 【需管理员】 |
| stor.getConf | 获取存储配置 | 【需管理员】 |
| stor.setConf | 设置存储配置 | 【需管理员】 |
| stor.addDisk | 添加磁盘 | 【需管理员】 |
| stor.removeDisk | 移除磁盘 | 【需管理员】 |
| stor.readdDisk | 重新添加磁盘 | 【需管理员】 |
| stor.replaceDisk | 更换磁盘 | 【需管理员】 |
| stor.getUserStorage | 获取当前用户存储信息 | ✅ |
| stor.setUserStorage | 设置用户配额 | 【需管理员】 |
| stor.getTeamStorage | 获取团队存储 | 【需管理员】 |
| stor.setTeamStorage | 设置团队存储 | 【需管理员】 |
| stor.makeTeamStorage | 创建团队存储 | 【需管理员】 |
| stor.listFreeDisk | 列出空闲磁盘 | 【需管理员】 |
| stor.listCachedev | 列出缓存设备 | 【需管理员】 |
| stor.createCache | 创建缓存 | 【需管理员】 |
| stor.attachCache | 附加缓存 | 【需管理员】 |
| stor.detachCache | 分离缓存 | 【需管理员】 |
| stor.runSmartTest | 运行磁盘自检 | 【需管理员】 |
| stor.abortSmartTest | 取消自检 | 【需管理员】 |
| stor.enableSmart | 启用 SMART | 【需管理员】 |
| stor.setTrashbin | 设置回收站 | 【需管理员】 |
| stor.getRemovableConf | 获取外置存储配置 | 【需管理员】 |
| stor.setRemovableConf | 设置外置存储配置 | 【需管理员】 |
| stor.listRemovable | 列出外置存储 | 【需管理员】 |
| stor.eject | 弹出外置存储 | 【需管理员】 |
| stor.calcSpace | 计算空间 | 【需管理员】 |
| stor.storAddDiskInfo | 磁盘信息 | 【需管理员】 |
| stor.getDiskIdleTime | 获取磁盘休眠时间 | 【需管理员】 |
| stor.setDiskIdleTime | 设置磁盘休眠时间 | 【需管理员】 |
| stor.getDiskWakeup | 获取磁盘唤醒设置 | 【需管理员】 |
| stor.setDiskWakeup | 设置磁盘唤醒 | 【需管理员】 |
| stor.general | 存储总览 | 【需管理员】 |
| stor.lvActive | 激活逻辑卷 | 【需管理员】 |
| stor.zRecover | ZFS 恢复 | 【需管理员】 |
| stor.zImportList | ZFS 导入列表 | 【需管理员】 |
| stor.zImport | ZFS 导入 | 【需管理员】 |
| stor.zClear | ZFS 清除 | 【需管理员】 |
| stor.zOnline | ZFS 上线 | 【需管理员】 |
| stor.zExport | ZFS 导出 | 【需管理员】 |
| stor.zScrub | ZFS Scrub | 【需管理员】 |
| stor.delRec | 删除记录 | 【需管理员】 |
| stor.extend | 扩展存储 | 【需管理员】 |
| stor.resize | 调整存储大小 | 【需管理员】 |
| stor.removeWarn | 移除警告 | 【需管理员】 |
| stor.addSpareDisk | 添加备用磁盘 | 【需管理员】 |
| stor.removeDiskCheck | 检查移除磁盘 | 【需管理员】 |
| stor.diskMount | 磁盘挂载状态 | 【需管理员】 |
| stor.stop | 停止存储服务 | 【需管理员】 |
| stor.create | 创建存储池 | 【需管理员】 |
| stor.umount | 卸载存储池 | 【需管理员】 |

### 用户管理（user.*）

| API | 说明 | 权限 |
|-----|------|------|
| user.info | 当前用户信息 | ✅ |
| user.list | 用户列表 | 【需管理员】 |
| user.add | 添加用户 | 【需管理员】 |
| user.del | 删除用户 | 【需管理员】 |
| user.mod | 修改用户 | 【需管理员】 |
| user.active | 激活用户 | 【需管理员】 |
| user.unfreeze | 解冻用户 | 【需管理员】 |
| user.isAdmin | 检查是否管理员 | ✅ |
| user.setAdmin | 设置管理员 | 【需管理员】 |
| user.quota | 用户配额 | 【需管理员】 |
| user.login | 用户登录 | ✅ |
| user.logout | 用户登出 | ✅ |
| user.tokenLogin | Token 登录 | ✅ |
| user.authToken | 验证 Token | ✅ |
| user.auth | 认证 | ✅ |
| user.changePassword | 修改密码 | ✅ |
| user.groupList | 用户组列表 | 【需管理员】 |
| user.groupAdd | 添加用户组 | 【需管理员】 |
| user.groupDel | 删除用户组 | 【需管理员】 |
| user.groupMod | 修改用户组 | 【需管理员】 |
| user.groupInfo | 用户组信息 | 【需管理员】 |
| user.groupUsers | 用户组成员 | 【需管理员】 |
| user.groupAddUsers | 添加用户到组 | 【需管理员】 |
| user.groupDelUsers | 从组删除用户 | 【需管理员】 |
| user.listUG | 列出用户与组关系 | 【需管理员】 |
| user.checkNewUser | 检查用户名是否可用 | ✅ |
| user.checkNewGroup | 检查用户组名是否可用 | ✅ |
| user.listLoginDevice | 列出登录设备 | ✅ |
| user.kickLoginDevice | 踢出登录设备 | ✅ |
| user.add1000 | 添加 1000 UID 用户 | 【需管理员】 |

### 系统监控（appcgi.resmon.*）

| API | 说明 | 权限 |
|-----|------|------|
| appcgi.resmon.gen | 系统状态总览 | ✅ |
| appcgi.resmon.cpu | CPU / 温度 / 负载 | ✅ |
| appcgi.resmon.mem | 内存信息 | ✅ |
| appcgi.resmon.disk | 磁盘 I/O | ✅ |
| appcgi.resmon.net | 网卡流量 | ✅ |
| appcgi.resmon.gpu | GPU 状态 | ✅ |
| appcgi.resmon.npu | NPU 状态 | ✅ |
| appcgi.resmon.battery | UPS 电池状态 | ✅ |
| appcgi.resmon.sysFan | 系统风扇 | ✅ |
| appcgi.resmon.proc.list | 进程列表 | ✅ |
| appcgi.resmon.proc.signal | 发送进程信号 | ✅ |
| appcgi.resmon.proc.srv | 服务进程管理 | ✅ |
| appcgi.resmon.alert.getBeepEvents | 获取蜂鸣器事件 | ✅ |
| appcgi.resmon.alert.setBeepEvents | 设置蜂鸣器事件 | ✅ |
| appcgi.resmon.alert.muteBeeper | 静音 | ✅ |
| appcgi.resmon.alert.getBeepReasons | 获取静音原因 | ✅ |
| appcgi.resmon.alert.getSupportedBeepEvents | 支持的蜂鸣事件 | ✅ |

### 网络管理（appcgi.network.* / appcgi.netsvr.*）

| API | 说明 | 权限 |
|-----|------|------|
| appcgi.network.net.list | 网卡列表 | ✅ |
| appcgi.network.net.info | 网卡详情 | ✅ |
| appcgi.network.net.set | 设置网卡 | 【需管理员】 |
| appcgi.network.net.add | 添加网卡 | 【需管理员】 |
| appcgi.network.net.del | 删除网卡 | 【需管理员】 |
| appcgi.network.net.state | 网卡状态 | ✅ |
| appcgi.network.net.detect | 检测网卡 | 【需管理员】 |
| appcgi.network.net.conn | 连接网卡 | 【需管理员】 |
| appcgi.network.net.disc | 断开网卡 | 【需管理员】 |
| appcgi.network.net.reset | 重置网络 | 【需管理员】 |
| appcgi.network.net.bridge | 创建网桥 | 【需管理员】 |
| appcgi.network.net.arping | ARP Ping | ✅ |
| appcgi.network.net.getMultiGWStatus | 多网关状态 | ✅ |
| appcgi.network.net.setMultiGW | 设置多网关 | 【需管理员】 |
| appcgi.network.net.getNicPerformanceMode | 获取 NIC 性能模式 | ✅ |
| appcgi.network.net.setNicPerformanceMode | 设置 NIC 性能模式 | 【需管理员】 |
| appcgi.network.route.list | 路由表 | ✅ |
| appcgi.network.static.list | 静态路由列表 | ✅ |
| appcgi.network.static.add | 添加静态路由 | 【需管理员】 |
| appcgi.network.static.del | 删除静态路由 | 【需管理员】 |
| appcgi.network.static.set | 设置静态路由 | 【需管理员】 |
| appcgi.network.hostname | 主机名 | ✅ |
| appcgi.network.gen.info | 网络基本信息 | ✅ |
| appcgi.network.gen.set | 设置网络基本信息 | 【需管理员】 |
| appcgi.network.gw.getting | 获取网关 | ✅ |
| appcgi.network.gw.setting | 设置网关 | 【需管理员】 |
| appcgi.network.ssh.status | SSH 状态 | ✅ |
| appcgi.network.ssh.switch | 开关 SSH | 【需管理员】 |
| appcgi.network.ssh.set | 设置 SSH | 【需管理员】 |
| appcgi.network.wifi.open | 打开 WiFi | 【需管理员】 |
| appcgi.network.wifi.close | 关闭 WiFi | 【需管理员】 |
| appcgi.network.wifi.apList | AP 列表 | ✅ |
| appcgi.network.wifi.connectedAP | 已连接 AP | ✅ |
| appcgi.network.wifi.connectUnknownAP | 连接未知 AP | 【需管理员】 |
| appcgi.network.wifi.connectHiddenAP | 连接隐藏 AP | 【需管理员】 |
| appcgi.network.wifi.connectKnownAP | 连接已知 AP | 【需管理员】 |
| appcgi.network.wifi.getKnownAPInfo | 获取已知 AP 信息 | ✅ |
| appcgi.network.wifi.setKnownAPInfo | 设置已知 AP | ✅ |
| appcgi.network.wifi.ignoreKnownAP | 忽略已知 AP | ✅ |
| appcgi.netsvr.ddns.provider.list | DDNS 服务商列表 | ✅ |
| appcgi.netsvr.ddns.record.list | DDNS 记录列表 | ✅ |
| appcgi.netsvr.ddns.record.create | 创建 DDNS 记录 | ✅ |
| appcgi.netsvr.ddns.record.update | 更新 DDNS 记录 | ✅ |
| appcgi.netsvr.ddns.record.remove | 删除 DDNS 记录 | ✅ |
| appcgi.netsvr.ddns.record.detail | DDNS 记录详情 | ✅ |
| appcgi.netsvr.ddns.record.test | 测试 DDNS | ✅ |
| appcgi.netsvr.ddns.record.refresh | 刷新 DDNS | ✅ |
| appcgi.netsvr.conn.list | 外网连接列表 | ✅ |
| appcgi.netsvr.conn.create | 创建外网连接 | 【需管理员】 |
| appcgi.netsvr.conn.open | 开启外网连接 | 【需管理员】 |
| appcgi.netsvr.conn.quit | 关闭外网连接 | 【需管理员】 |
| appcgi.netsvr.conn.status | 外网连接状态 | ✅ |
| appcgi.netsvr.conn.getconfig | 获取连接配置 | ✅ |
| appcgi.netsvr.conn.setconfig | 设置连接配置 | 【需管理员】 |
| appcgi.netsvr.conn.change | 变更连接 | 【需管理员】 |
| appcgi.netsvr.cert.list | 证书列表 | ✅ |
| appcgi.netsvr.cert.apply | 申请证书 | 【需管理员】 |
| appcgi.netsvr.cert.renew | 续期证书 | 【需管理员】 |
| appcgi.netsvr.cert.replace | 替换证书 | 【需管理员】 |
| appcgi.netsvr.cert.upload | 上传证书 | 【需管理员】 |
| appcgi.netsvr.cert.remove | 删除证书 | 【需管理员】 |
| appcgi.netsvr.cert.getuse | 获取证书使用情况 | ✅ |
| appcgi.netsvr.cert.setuse | 设置证书使用 | 【需管理员】 |
| appcgi.netsvr.cert.sysreset | 重置系统证书 | 【需管理员】 |
| appcgi.netsvr.domain.list | 域名列表 | ✅ |
| appcgi.netsvr.domain.sharecheck | 域名共享检查 | ✅ |
| appcgi.netsvr.fnassistant.open | 开启`_fnassistant_` | 【需管理员】 |
| appcgi.netsvr.fnassistant.close | 关闭`_fnassistant_` | 【需管理员】 |
| appcgi.netsvr.fnassistant.info | `_fnassistant_`信息 | ✅ |
| appcgi.netsvr.network.list | 网络列表 | ✅ |

### 共享服务（appcgi.share.*）

| API | 说明 | 权限 |
|-----|------|------|
| appcgi.share.smb.opt | SMB 选项 | 【需管理员】 |
| appcgi.share.smb.set | SMB 设置 | 【需管理员】 |
| appcgi.share.smb.share.opt | SMB 共享选项 | 【需管理员】 |
| appcgi.share.smb.share.set | SMB 共享设置 | 【需管理员】 |
| appcgi.share.smb.tm.set | SMB Time Machine 设置 | 【需管理员】 |
| appcgi.share.webdav.opt | WebDAV 选项 | 【需管理员】 |
| appcgi.share.webdav.set | WebDAV 设置 | 【需管理员】 |
| appcgi.share.webdav.share.opt | WebDAV 共享选项 | 【需管理员】 |
| appcgi.share.webdav.share.set | WebDAV 共享设置 | 【需管理员】 |
| appcgi.share.ftp.opt | FTP 选项 | 【需管理员】 |
| appcgi.share.ftp.set | FTP 设置 | 【需管理员】 |
| appcgi.share.ftp.share.opt | FTP 共享选项 | 【需管理员】 |
| appcgi.share.ftp.share.set | FTP 共享设置 | 【需管理员】 |
| appcgi.share.nfs.opt | NFS 选项 | 【需管理员】 |
| appcgi.share.nfs.set | NFS 设置 | 【需管理员】 |
| appcgi.share.nfs.share.opt | NFS 共享选项 | 【需管理员】 |
| appcgi.share.nfs.share.set | NFS 共享设置 | 【需管理员】 |
| appcgi.share.dlna.opt | DLNA 选项 | 【需管理员】 |
| appcgi.share.dlna.set | DLNA 设置 | 【需管理员】 |
| appcgi.share.dlna.share.opt | DLNA 共享选项 | 【需管理员】 |
| appcgi.share.dlna.share.set | DLNA 共享设置 | 【需管理员】 |
| appcgi.share.check.port | 检查端口占用 | 【需管理员】 |
| appcgi.share.team.allowShare | 允许团队分享 | 【需管理员】 |

### 远程挂载（appcgi.mountmgr.*）

| API | 说明 | 权限 |
|-----|------|------|
| appcgi.mountmgr.list | 挂载列表 | ✅ |
| appcgi.mountmgr.mount | 挂载 | 【需管理员】 |
| appcgi.mountmgr.umount | 卸载 | 【需管理员】 |
| appcgi.mountmgr.check | 检查挂载 | ✅ |
| appcgi.mountmgr.shares | 共享挂载列表 | ✅ |
| appcgi.mountmgr.mountInfo | 挂载详情 | ✅ |
| appcgi.mountmgr.task.list | 任务列表 | ✅ |
| appcgi.mountmgr.task.detail | 任务详情 | ✅ |
| appcgi.mountmgr.task.cancel | 取消任务 | ✅ |
| appcgi.mountmgr.setting.detail | 挂载设置详情 | ✅ |
| appcgi.mountmgr.setting.update | 更新挂载设置 | 【需管理员】 |
| appcgi.mountmgr.dfs.startUpload | 开始上传 | ✅ |
| appcgi.mountmgr.dfs.cleanUploadCacheDir | 清理上传缓存 | ✅ |
| appcgi.mountmgr.cache.refresh | 刷新缓存 | 【需管理员】 |
| appcgi.mountmgr.dfs.acquireUploadCacheDir | 获取上传缓存目录 | ✅ |

### 系统信息（appcgi.sysinfo.*）

| API | 说明 | 权限 |
|-----|------|------|
| appcgi.sysinfo.getTrimVersion | 获取 fnOS 版本 | ✅ |
| appcgi.sysinfo.getTrimMachineType | 机器类型 | ✅ |
| appcgi.sysinfo.getTrimMachineFeature | 机器特性 | ✅ |
| appcgi.sysinfo.isTrimMachine | 是否 Trim 机器 | ✅ |
| appcgi.sysinfo.getTrimDisk | Trim 磁盘信息 | ✅ |
| appcgi.sysinfo.getHardwareInfo | 硬件信息 | ✅ |
| appcgi.sysinfo.getMachineId | 机器 ID | ✅ |
| appcgi.sysinfo.getHostName | 主机名 | ✅ |
| appcgi.sysinfo.setHostName | 设置主机名 | 【需管理员】 |
| appcgi.sysinfo.initHostName | 初始化主机名 | 【需管理员】 |
| appcgi.sysinfo.getUptime | 运行时间 | ✅ |
| appcgi.sysinfo.getNetInfo | 网络信息 | ✅ |
| appcgi.sysinfo.getTimeSetting | 时间设置 | ✅ |
| appcgi.sysinfo.setTimeSetting | 设置时间 | 【需管理员】 |
| appcgi.sysinfo.getTimezoneList | 时区列表 | ✅ |
| appcgi.sysinfo.getFanMode | 风扇模式 | ✅ |
| appcgi.sysinfo.setFanMode | 设置风扇模式 | 【需管理员】 |
| appcgi.sysinfo.getPowerPlanStatus | 电源计划状态 | ✅ |
| appcgi.sysinfo.listPowerPlan | 电源计划列表 | ✅ |
| appcgi.sysinfo.addPowerPlan | 添加电源计划 | 【需管理员】 |
| appcgi.sysinfo.modifyPowerPlan | 修改电源计划 | 【需管理员】 |
| appcgi.sysinfo.deletePowerPlan | 删除电源计划 | 【需管理员】 |
| appcgi.sysinfo.setPowerPlanStatus | 设置电源计划状态 | 【需管理员】 |
| appcgi.sysinfo.getBootOnPowerFlag | 来电启动设置 | ✅ |
| appcgi.sysinfo.setBootOnPowerFlag | 设置来电启动 | 【需管理员】 |
| appcgi.sysinfo.getReservedPartition | 保留分区信息 | ✅ |
| appcgi.sysinfo.nextPowerOffTime | 下次关机时间 | ✅ |
| appcgi.sysrestore.getInfo | 系统恢复信息 | ✅ |
| appcgi.sysrestore.setSystemRecovery | 设置系统恢复 | 【需管理员】 |
| appcgi.sysrestore.getSysconfUploadPath | 获取配置上传路径 | 【需管理员】 |
| appcgi.sysrestore.importSysconf | 导入系统配置 | 【需管理员】 |
| appcgi.sysrestore.exportSysconf | 导出系统配置 | 【需管理员】 |
| appcgi.sysrestore.sysconfImportProgress | 导入进度 | 【需管理员】 |

### 备份（appcgi.backup.*）

| API | 说明 |
|-----|------|
| appcgi.backup.storage.list | 备份存储列表 |
| appcgi.backup.storage.add | 添加备份存储 |
| appcgi.backup.storage.update | 更新备份存储 |
| appcgi.backup.storage.delete | 删除备份存储 |
| appcgi.backup.storage.checkConnection | 检查连接 |
| appcgi.backup.storage.getQuota | 获取配额 |
| appcgi.backup.storage.listDir | 列出备份目录 |
| appcgi.backup.task.list | 备份任务列表 |
| appcgi.backup.task.add | 添加备份任务 |
| appcgi.backup.task.update | 更新备份任务 |
| appcgi.backup.task.delete | 删除备份任务 |
| appcgi.backup.task.run | 运行备份任务 |
| appcgi.backup.task.stop | 停止备份任务 |
| appcgi.backup.task.detail | 备份任务详情 |
| appcgi.backup.task.enable | 启用备份任务 |
| appcgi.backup.task.disable | 禁用备份任务 |
| appcgi.backup.task.operations | 备份任务操作 |
| appcgi.backup.logger.list | 备份日志列表 |
| appcgi.backup.nas.find | 发现 NAS |

### 其他杂项 API

| API | 说明 |
|-----|------|
| appcgi.finder.fileSearch | 文件搜索 |
| appcgi.finder.trashSearch | 回收站搜索 |
| appcgi.finder.cancelSearch | 取消搜索 |
| appcgi.finder.searchOtherSharing | 搜索他人分享 |
| appcgi.filestor.getAppDirList | 应用目录列表 |
| appcgi.filestor.getSysPartInfo | 系统分区信息 |
| appcgi.filestor.getTeamDirList | 团队目录列表 |
| appcgi.filestor.isMountPoint | 是否挂载点 |
| appcgi.eventlogger.common.list | 事件日志 |
| appcgi.eventlogger.common.archive | 归档日志 |
| appcgi.eventlogger.common.clear | 清除日志 |
| appcgi.eventlogger.common.export | 导出日志 |
| appcgi.eventlogger.debuglog.copyStart | 开始调试日志 |
| appcgi.eventlogger.debuglog.copyStop | 停止调试日志 |
| appcgi.ipblocker.queryAllowList | IP 白名单 |
| appcgi.ipblocker.addAllowList | 添加白名单 |
| appcgi.ipblocker.deleteAllowList | 删除白名单 |
| appcgi.ipblocker.queryDenyList | IP 黑名单 |
| appcgi.ipblocker.addDenyList | 添加黑名单 |
| appcgi.ipblocker.deleteDenyList | 删除黑名单 |
| appcgi.ipblocker.queryAutoBlockRule | 自动封锁规则 |
| appcgi.ipblocker.autoBlock | 自动封锁 |
| appcgi.ipblocker.autoBlockRule | 设置自动封锁规则 |
| appcgi.security.firewall.getting | 防火墙获取 |
| appcgi.security.firewall.setting | 防火墙设置 |
| appcgi.security.firewall.iflist | 防火墙接口列表 |
| appcgi.security.firewall.servlist | 防火墙服务列表 |
| appcgi.security.flowaudit.traffic | 流量审计 |
| appcgi.screen.getScreenSize | 屏幕尺寸 |
| appcgi.screen.getScreenImage | 屏幕截图 |
| appcgi.screen.getScreenVideo | 屏幕录像 |
| appcgi.screen.isSleeping | 休眠状态 |
| appcgi.screen.setOptions | 设置屏幕选项 |
| appcgi.screen.setScreenImage | 设置屏幕图像 |
| appcgi.screen.setScreenVideo | 设置屏幕录像 |
| appcgi.screen.getImageUploadPath | 获取图像上传路径 |
| appcgi.license.soft.list | 软件许可证列表 |
| appcgi.license.soft.get | 获取许可证 |
| appcgi.license.soft.code.license | 许可编码 |
| appcgi.license.soft.code.active | 激活许可 |
| appcgi.license.soft.trial | 试用许可 |
| appcgi.license.soft.remove | 移除许可 |
| appcgi.license.soft.recover | 恢复许可 |
| appcgi.iscsimgr.iscsi.lun.list | iSCSI LUN 列表 |
| appcgi.sharesvr.share.link.list | 分享链接列表 |
| appcgi.sharesvr.share.link.create | 创建分享链接 |
| appcgi.sharesvr.share.link.remove | 删除分享链接 |
| appcgi.sharesvr.share.link.update | 更新分享链接 |
| appcgi.sharesvr.share.link.get | 获取分享链接 |
| appcgi.sharesvr.share.link.default | 默认分享链接 |
| appcgi.sharesvr.share.permission.get | 获取分享权限 |
| appcgi.sharesvr.share.permission.set | 设置分享权限 |
| icenter.gen / icenter.net / icenter.svc | 智能中心 |
| exconn.getDomain / exconn.setDomain | 外网域名 |
| usrdat.get / usrdat.set / usrdat.del | 用户数据读写 |
| usrdat.getArray / usrdat.setArray | 数组类型用户数据 |
| notify.list / notify.unreadTotal | 通知列表 |
| notify.setRead / notify.setReadAll | 标记已读 |
| notify.del / notify.delAll | 删除通知 |
| log.list / log.graph | 日志列表/图表 |
| log.clear | 清除日志 |
| liveupdate.check / status / update / fixapt | 在线更新 |
| power.poweroff / power.reboot | 关机/重启 |

| errno | 说明 |
|-------|------|
| 4096 | 系统内部错误 |
| 4097 | 系统繁忙 |
| 4098 | 内存不足 |
| 4099 | 磁盘空间不足 |
| 4100 | 文件或目录不存在 |
| 4101 | 无效的文件名或路径 |
| 4102 | 文件或目录已存在 |
| 4103 | 存储空间不存在或未挂载 |
| 4104 | 文件名或文件路径长度超过限制 |
| 4105 | 目的路径是目录 |
| 4112 | 目的路径不是目录 |
| 4121 | 文件系统只读 |
| 4128 | I/O错误 |
| 4208 | 数据库读写错误 |
| 4224 | 没有登录 |
| 4352 | 权限不足 |
| 4386 | 可用容量不足 |
| 8192 | 参数错误 |
| 131072 | 用户名或密码错误 |
| 131073 | 用户名不存在 |
| 131074 | 用户名已存在 |
| 131329 | 用户群组不存在 |
| 131330 | 用户群组已存在 |
| 135168 | 无效的凭证 |
| 139264 | 不能对当前登录用户执行该操作 |
| 196608 | 磁盘繁忙 |
| 196609 | 磁盘数量不足以执行该操作 |
| 196610 | 磁盘数量超过需要 |
| 196624 | 存储池当前状态下不允许该操作 |
| 327681 | 无可用存储空间 |
| 327685 | 目标目录是源目录的子目录 |
| 65534 | 验签失败 |
| 65535 | 未知错误 |
| 100000001 | 操作太频繁，请稍后重试 |
| 100000002 | 参数错误 |
| 100000003 | 重复的请求 |
| 100000004 | 无效的操作 |
| 100000006 | 服务器开小差了，请稍后重试 |
| 2031616 | 检查更新失败 |
| 2031620 | 已是最新版本 |
| 2031621 | 执行更新脚本出错 |
| 2031632 | 正在更新中 |
| 33554944 | 端口号已被占用 |
| 33554945 | 系统预留端口号 |
| 52428823 | 连接失败，请确认容器是否已启动 |