import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes";

export default [
  // Auth routes (public)
  layout("routes/_auth.tsx", [
    route("auth/sign-up", "routes/_auth.sign-up.tsx"),
    route("auth/sign-in", "routes/_auth.sign-in.tsx"),
    route("auth/forgot-password", "routes/_auth.forgot-password.tsx"),
    route("auth/verify-email", "routes/_auth.verify-email.tsx"),
  ]),

  // App routes (authenticated)
  layout("routes/_app.tsx", [
    index("routes/_app._index.tsx"),
    route("chat", "routes/_app.chat.tsx"),
    route("roadmaps", "routes/_app.roadmaps.tsx"),
    route("roadmaps/:id", "routes/_app.roadmaps.$id.tsx"),
    route("roadmaps/:id/lessons/:lessonId", "routes/_app.roadmaps.$id.lessons.$lessonId.tsx"),
    route("roadmaps/:id/quiz", "routes/_app.roadmaps.$id.quiz.tsx"),
    route("profile", "routes/_app.profile.tsx"),
    // Battle (Phase 4) — landing, create/join/lobby are Plan 05;
    // pre/room/results are stubs for Plans 06/07.
    route("battle", "routes/_app.battle.tsx"),
    route("battle/new", "routes/_app.battle.new.tsx"),
    route("battle/join", "routes/_app.battle.join.tsx"),
    route("battle/lobby/:code", "routes/_app.battle.lobby.$code.tsx"),
    route("battle/pre/:id", "routes/_app.battle.pre.$id.tsx"),
    route("battle/room/:id", "routes/_app.battle.room.$id.tsx"),
    route("battle/results/:id", "routes/_app.battle.results.$id.tsx"),
  ]),
] satisfies RouteConfig;
