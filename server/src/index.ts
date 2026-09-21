import { createApp } from "./app.js";

const PORT = process.env.PORT || 9030;
const app = createApp();

app.listen(PORT, () => {
  console.log(`[Product Workbench Server] listening on http://localhost:${PORT}`);
});
