// Stand-in for the `server-only` package in unit tests. Next.js turns that import into a
// build error when client code pulls in server code; plain Node would throw instead.
export {};
