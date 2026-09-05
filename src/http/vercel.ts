import { handleRemoteHttpRequest } from "./router.js";

export const vercelFetchHandler = {
  fetch: handleRemoteHttpRequest,
};

export default vercelFetchHandler;
