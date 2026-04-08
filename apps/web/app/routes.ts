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
  ]),
] satisfies RouteConfig;
