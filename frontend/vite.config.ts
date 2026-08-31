import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // In local `npm run dev` (outside Docker), proxy API calls to the
      // backend running on :4000. Inside Docker, nginx.conf does the
      // equivalent proxying instead (see that file).
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
