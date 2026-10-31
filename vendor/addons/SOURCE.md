Three.js 0.180.0官方npm发行源码，2026-10-30下载：

- https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/GLTFLoader.js
- https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/utils/BufferGeometryUtils.js

本地唯一修改：运行时代码中的`from 'three'`改为`from '../../three.module.js'`，使离线APK不依赖import map或CDN。MIT许可证沿用vendor/LICENSE。除GLTFLoader→BufferGeometryUtils外无额外静态依赖；本适配器不擅自启用Draco/KTX2/meshopt解码，压缩模型需要以后明确配置相应解码器。
