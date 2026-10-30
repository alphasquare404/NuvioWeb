import { createMdbListBridgeServer } from "./bridge.mjs";

const port = Math.max(1, Number(process.env.PORT || 8080) || 8080);
const server = createMdbListBridgeServer();

server.listen(port, "0.0.0.0", () => {
  console.log(`MDBList bridge listening on ${port}`);
});
