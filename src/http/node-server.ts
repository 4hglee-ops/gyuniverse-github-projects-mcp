import { createServer } from "node:http";
import { handleRemoteHttpRequest } from "./router.js";

const port = Number(process.env.PORT ?? 3000);

const server = createServer(async (req, res) => {
  const host = req.headers.host ?? `localhost:${port}`;
  const url = new URL(req.url ?? "/", `http://${host}`);
  const body = await new Promise<string>((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });

  const request = new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: ["GET", "HEAD"].includes(req.method ?? "") ? undefined : body,
  });

  const response = await handleRemoteHttpRequest(request);
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(port, () => {
  console.log(`remote MCP HTTP server listening on ${port}`);
});
