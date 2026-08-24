import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Los paneles HTML leen archivos de src/panels en el servidor
  outputFileTracingIncludes: {
    "/produccion": ["./src/panels/produccion.html"],
    "/ventas": ["./src/panels/produccion.html"],
    "/pedidos": ["./src/panels/pedidos.html"],
    "/tienda": ["./src/panels/tienda.html"],
    "/mermas": ["./src/panels/mermas.html"],
    "/inventario-food": ["./src/panels/inventario-food.html"],
    "/produccion-pesaje": ["./src/panels/produccion-pesaje.html"],
    "/vitrina": ["./src/panels/vitrina.html"],
    "/recepcion": ["./src/panels/recepcion.html"],
    "/catalogo": ["./src/panels/catalogo.html"],
    "/stock-alertas": ["./src/panels/stock-alertas.html"],
    "/actividad-tiendas": ["./src/panels/actividad-tiendas.html"],
    "/analisis-ventas": ["./src/panels/analisis-ventas.html"],
    "/recetario": ["./src/panels/recetario.html"],
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "heladerialarrs.cl" }],
  },
};

export default nextConfig;
