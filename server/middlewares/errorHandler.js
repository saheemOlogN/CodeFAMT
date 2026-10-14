import { ZodError } from 'zod';
export function errorHandler(error, req, res, next) {
  if (error instanceof ZodError)
    return res.status(400).json({
      error: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    });
  if (error.code === 11000)
    return res.status(409).json({ error: 'This record already exists. Refresh and try again.' });
  if (error.type === 'entity.too.large')
    return res.status(413).json({ error: 'Request is too large.' });
  if (error.type === 'entity.parse.failed')
    return res.status(400).json({ error: 'Invalid JSON request.' });
  console.error(error.message);
  res
    .status(error.status || 500)
    .json({ error: error.status ? error.message : 'Something went wrong. Please try again.' });
}
