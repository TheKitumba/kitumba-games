import { Suspense } from 'react'
import { Outlet, ScrollRestoration } from 'react-router'

// Synthwave scene shared by every page: the hub and all games render on top of it
export default function Layout() {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#03040c] text-white select-none">
      <div className="stars pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 top-[38%] h-[2px] bg-gradient-to-r from-transparent via-fuchsia-400/70 to-transparent blur-[1px]" />
      <div className="sun pointer-events-none absolute top-[38%] left-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full" />
      <div className="floor-wrap pointer-events-none absolute inset-x-0 top-[38%] bottom-0">
        <div className="floor" />
      </div>
      <div className="scanlines pointer-events-none absolute inset-0 z-50" />

      <div className="relative z-10">
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </div>
      <ScrollRestoration />
    </div>
  )
}

function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center font-mono text-xs tracking-[0.5em] text-cyan-300/70 uppercase">
      A carregar…
    </div>
  )
}
