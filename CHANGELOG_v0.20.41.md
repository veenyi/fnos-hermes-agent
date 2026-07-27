# fnos-hermes-agent v0.20.41 版本更新说明

## 问题修复

### 1. 修复移动端「添加模型服务」弹窗无法滚动到底部按钮
- **现象**：手机端进入「模型」→「添加模型服务」，选择「自定义」后弹窗内容超出屏幕，但无法下滑，导致「测试连接」「保存」等底部按钮不可见。
- **根因**：弹窗在小屏下仅依赖整个 `.modal` 的 `overflow-y:auto` 滚动，受移动端动态视口、键盘弹起及触摸事件分发影响，滚动体验不稳定。
- **修复**：在 `@media(max-width:600px)` 下对 `#providerModal` 采用 flex 纵向布局：
  - `.modal` 固定最大高度 `calc(100dvh - 10vh)`，并隐藏外层滚动；
  - `.modal-body` 单独可滚动（`-webkit-overflow-scrolling: touch`、`overscroll-behavior: contain`）；
  - `.modal-foot` 固定于底部，确保「测试连接」「保存」始终可见。
- **验证**：构建 `v0.20.41.fpk` 后结构校验通过（外层 9 项、内层 5 项、trim-cli 与 ws vendor 均保留）。

## 安装/升级

在 fnOS 应用中心直接上传 `fnos-hermes-agent_v0.20.41.fpk` 升级即可。升级后无需额外配置。
