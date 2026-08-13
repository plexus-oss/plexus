// WebGPU ambient types (GPUDevice, GPUBuffer, navigator.gpu, …) for the GPU
// chart renderers in components/ui/charts/. Previously these globals arrived
// transitively via the 3D model viewer's three/examples imports; that panel
// was removed, so the reference is made explicit here.
/// <reference types="@webgpu/types" />
