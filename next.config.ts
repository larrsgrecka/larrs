import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Los paneles HTML leen archivos de src/panels en el servidor
  outputFileTracingIncludes: {
    "/produccion": ["./src/panels/produccion.html"],
    "/ventas": ["./src/panels/produccion.html"],
    "/pedidos": ["./src/panels/pedidos.html"],
    "/tienda": ["./src/panels/tienda.html"],
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "heladerialarrs.cl" }],
  },
};

export default nextConfig;
