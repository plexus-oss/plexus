"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";

interface GPUDeviceContextType {
  device: GPUDevice | null;
  isLoading: boolean;
  error: Error | null;
  isWebGPUSupported: boolean;
}

const GPUDeviceContext = createContext<GPUDeviceContextType>({
  device: null,
  isLoading: false, // Default to not loading when no provider
  error: null,
  isWebGPUSupported: false,
});

/**
 * Hook to access the shared GPU device.
 * Returns default values if used outside of GPUDeviceProvider (backwards compatible).
 */
export function useGPUDevice() {
  return useContext(GPUDeviceContext);
}

interface GPUDeviceProviderProps {
  children: ReactNode;
  /** Prefer WebGPU over WebGL. If false or WebGPU unavailable, charts fall back to WebGL. */
  preferWebGPU?: boolean;
}

/**
 * Provides a shared WebGPU device to all charts in the tree.
 * This allows multiple charts to share a single GPU device for better performance.
 *
 * Usage:
 * ```tsx
 * <GPUDeviceProvider>
 *   <Dashboard>
 *     <LineChart ... />
 *     <LineChart ... />
 *     <LineChart ... />
 *   </Dashboard>
 * </GPUDeviceProvider>
 * ```
 */
export function GPUDeviceProvider({
  children,
  preferWebGPU = true,
}: GPUDeviceProviderProps) {
  const [device, setDevice] = useState<GPUDevice | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isWebGPUSupported, setIsWebGPUSupported] = useState(false);
  const initRef = useRef(false);

  useEffect(() => {
    // Prevent double initialization in strict mode
    if (initRef.current) return;
    initRef.current = true;

    async function initDevice() {
      if (!preferWebGPU) {
        setIsLoading(false);
        return;
      }

      if (!navigator.gpu) {
        console.warn("WebGPU not supported, charts will use WebGL fallback");
        setIsLoading(false);
        return;
      }

      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
          console.warn(
            "No WebGPU adapter found, charts will use WebGL fallback"
          );
          setIsLoading(false);
          return;
        }

        const gpuDevice = await adapter.requestDevice();

        // Handle device loss
        gpuDevice.lost.then((info) => {
          console.error("WebGPU device lost:", info.message);
          setDevice(null);
          setError(new Error(`GPU device lost: ${info.message}`));

          // Attempt to recover by reinitializing
          if (info.reason !== "destroyed") {
            initRef.current = false;
            initDevice();
          }
        });

        setDevice(gpuDevice);
        setIsWebGPUSupported(true);
        setIsLoading(false);
      } catch (err) {
        console.error("Failed to initialize WebGPU:", err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      }
    }

    initDevice();

    return () => {
      // Don't destroy device on unmount - it may be reused
      // Device cleanup happens automatically when page unloads
    };
  }, [preferWebGPU]);

  return (
    <GPUDeviceContext.Provider
      value={{ device, isLoading, error, isWebGPUSupported }}
    >
      {children}
    </GPUDeviceContext.Provider>
  );
}

