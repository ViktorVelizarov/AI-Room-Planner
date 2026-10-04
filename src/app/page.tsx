export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">
        AI Room Layout Generator
      </h1>
      <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">
        Upload photos of your room, let AI find the furniture, and see new
        layouts in 3D.
      </p>
      <p className="text-sm text-zinc-500">Work in progress.</p>
    </main>
  );
}
