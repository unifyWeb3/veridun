import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createVercelHandler } from '../src/api/vercel.js';

const handler = createVercelHandler();

export default async function (request: VercelRequest, response: VercelResponse) {
  return handler(request, response);
}