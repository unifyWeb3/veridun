import { handleVercelRequest } from '../src/api/vercel.js';

export default {
  async fetch(request: Request): Promise<Response> {
    return handleVercelRequest(request);
  },
};
