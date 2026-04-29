import * as React from "react";
import { Avatar as KumoAvatar } from "@cloudflare/kumo/primitives/avatar";
import { cn } from "~/lib/utils";

export const Avatar = React.forwardRef<
  React.ElementRef<typeof KumoAvatar.Root>,
  React.ComponentPropsWithoutRef<typeof KumoAvatar.Root>
>(({ className, ...props }, ref) => (
  <KumoAvatar.Root
    ref={ref}
    className={cn(
      "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full bg-kumo-fill",
      className
    )}
    {...props}
  />
));
Avatar.displayName = "Avatar";

export const AvatarImage = React.forwardRef<
  React.ElementRef<typeof KumoAvatar.Image>,
  React.ComponentPropsWithoutRef<typeof KumoAvatar.Image>
>(({ className, ...props }, ref) => (
  <KumoAvatar.Image
    ref={ref}
    className={cn("aspect-square h-full w-full", className)}
    {...props}
  />
));
AvatarImage.displayName = "AvatarImage";

export const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof KumoAvatar.Fallback>,
  React.ComponentPropsWithoutRef<typeof KumoAvatar.Fallback>
>(({ className, ...props }, ref) => (
  <KumoAvatar.Fallback
    ref={ref}
    className={cn(
      "flex h-full w-full items-center justify-center text-kumo-default",
      className
    )}
    {...props}
  />
));
AvatarFallback.displayName = "AvatarFallback";
