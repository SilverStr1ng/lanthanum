# Lanthanum · Cesium 原生 WebGPU 地球

基于 CesiumJS 1.147，增加实验性的原生 WebGPU 三维入口，保留原 WebGL2 路径。当前交付为原生 WebGPU 影像、地形与标准 Primitive 可用子集：多图层地理/Web Mercator 影像、heightmap/quantized-mesh、LOD、Color 外观和异步拾取；glTF、3D Tiles、Entity 和完整渲染效果仍在后续计划中。

使用 Node.js 24.15.0 / npm 11.6.1、支持硬件 WebGPU 的桌面 Chrome 或 Edge：

```sh
npm ci
npm run webgpu:start
```

打开终端输出的本地地址，即可拖拽、缩放、点击地球，并切换影像和标记。地球影像来自仓库自带的 Natural Earth，不需要 token。安装依赖需要联网，示例运行不请求外部地图服务。

执行原生 GPU 与页面交互回归：`npm run webgpu:test`。详细 API、支持边界与验证说明见 [WebGPU 使用说明](Apps/WebGPU/README.md)；阶段状态见 [进度报告](progress-report.md)、[完整兼容矩阵](compatibility-matrix.md)。旧 WebGL2 基线见 [baseline.md](baseline.md)。这是基本交互演示，不代表计划 S00—S24、MVP 或生产 v1 已通过验收。

## 上游 CesiumJS 说明

以下保留上游项目介绍；其中 npm 发行包和链接指向 Cesium 官方版本，不包含本分支的实验性后端。

[![Build Status](https://github.com/CesiumGS/cesium/actions/workflows/dev.yml/badge.svg)](https://github.com/CesiumGS/cesium/actions/workflows/dev.yml)
[![npm](https://img.shields.io/npm/v/cesium)](https://www.npmjs.com/package/cesium)
[![Docs](https://img.shields.io/badge/docs-online-orange.svg)](https://cesium.com/learn/)

![Cesium](https://github.com/CesiumGS/cesium/wiki/logos/Cesium_Logo_Color.jpg)

CesiumJS is a JavaScript library for creating 3D globes and 2D maps in a web browser without a plugin. It uses WebGL for hardware-accelerated graphics, and is cross-platform, cross-browser, and tuned for dynamic-data visualization.

Built on open formats, CesiumJS is designed for robust interoperability and scaling for massive datasets.

---

[**Examples**](https://sandcastle.cesium.com/) :earth_asia: [**Docs**](https://cesium.com/learn/cesiumjs-learn/) :earth_americas: [**Website**](https://cesium.com/cesiumjs) :earth_africa: [**Forum**](https://community.cesium.com/) :earth_asia: [**User Stories**](https://cesium.com/user-stories/)

---

## :rocket: Get started

Visit the [Downloads page](https://cesium.com/downloads/) to download a pre-built copy of CesiumJS.

### npm & yarn

If you’re building your application using a module bundler such as Webpack, Parcel, or Rollup, you can install CesiumJS via the [`cesium` npm package](https://www.npmjs.com/package/cesium):

```sh
npm install cesium --save
```

Then, import CesiumJS in your app code. Import individual modules to benefit from tree shaking optimizations through most build tools:

```js
import { Viewer } from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

const viewer = new Viewer("cesiumContainer");
```

In addition to the `cesium` package, CesiumJS is also [distributed as scoped npm packages for better dependency management](https://cesium.com/blog/2022/12/07/modular-structure-in-cesiumjs/):

- [`@cesium/engine`](./packages/engine/README.md) - CesiumJS's core, rendering, and data APIs
- [`@cesium/widgets`](./packages/widgets/README.md) - A widgets library for use with CesiumJS

### What next?

See our [Quickstart Guide](https://cesium.com/learn/cesiumjs-learn/cesiumjs-quickstart/) for more information on getting a CesiumJS app up and running.

Instructions for serving local data are in the CesiumJS
[Offline Guide](./Documentation/OfflineGuide/README.md).

Interested in contributing? See [CONTRIBUTING.md](CONTRIBUTING.md). :heart:

## :green_book: License

[Apache 2.0](http://www.apache.org/licenses/LICENSE-2.0.html). CesiumJS is free for both commercial and non-commercial use.

## :earth_americas: Where does the Global 3D Content come from?

The Cesium platform follows an [open-core business model](https://cesium.com/why-cesium/open-ecosystem/cesium-business-model/) with open source runtime engines such as CesiumJS and optional commercial subscription to Cesium ion.

CesiumJS can stream [3D content such as terrain, imagery, and 3D Tiles from the commercial Cesium ion platform](https://cesium.com/platform/cesium-ion/content/) alongside open standards from other offline or online services. We provide Cesium ion as the quickest option for all users to get up and running, but you are free to use any combination of content sources with CesiumJS that you please.

Bring your own data for tiling, hosting, and streaming from Cesium ion. [Using Cesium ion](https://cesium.com/ion/signup/) helps support CesiumJS development.

## :white_check_mark: Features

- Stream in 3D Tiles and other standard formats from Cesium ion or another source
- Visualize and analyze on a high-precision WGS84 globe
- Share with users on desktop or mobile

See more in the [CesiumJS Features Checklist](https://github.com/CesiumGS/cesium/wiki/CesiumJS-Features-Checklist).
