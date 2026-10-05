import { RoomAnalyzer } from "@/components/room-analyzer";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">
          AI Room Layout Generator
        </h1>
        <p className="max-w-xl text-lg text-zinc-600 dark:text-zinc-400">
          Upload photos of your room, let AI find the furniture, and see new
          layouts in 3D.
        </p>
      </header>
      <RoomAnalyzer />
    </main>
  );
}
