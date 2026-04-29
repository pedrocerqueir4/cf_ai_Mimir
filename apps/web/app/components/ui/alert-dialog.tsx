"use client";
import * as React from "react";
// Use Kumo's DialogRoot for `role="alertdialog"` semantics — internally it
// renders Base UI's AlertDialogRoot when role="alertdialog", which provides
// proper ARIA semantics and disables outside-click dismissal (per the Kumo
// component source at @cloudflare/kumo/dist/chunks/dialog-*.js, the role
// prop selects between Base UI Dialog vs AlertDialog primitives).
import { Dialog as KumoDialog } from "@cloudflare/kumo/components/dialog";
// Base UI Dialog parts (Backdrop/Portal/Popup) — these render correctly under
// either Dialog or AlertDialog root context (Kumo's role="alertdialog" picks
// the AlertDialog root from Base UI internally; the sub-parts are shared).
import { Dialog as BaseDialog } from "@cloudflare/kumo/primitives/dialog";

import { cn } from "~/lib/utils";
import { buttonVariants } from "~/components/ui/button";

/**
 * AlertDialog — destructive/confirmation modal.
 *
 * Per Phase 07 RESEARCH § Pattern 5: Kumo's Dialog accepts `role="alertdialog"`
 * to flip semantic + interaction model. The role prop on KumoDialog.Root
 * causes it to render Base UI's AlertDialogRoot internally (which:
 *   - sets ARIA role="alertdialog" on the popup
 *   - disables outside-click dismissal
 *   - keeps Escape-to-close
 * ), preserving Phase 06's AlertDialog contract.
 */
export const AlertDialog = ({
  children,
  ...rest
}: React.ComponentProps<typeof KumoDialog.Root>) => (
  <KumoDialog.Root role="alertdialog" {...rest}>
    {children}
  </KumoDialog.Root>
);

export const AlertDialogTrigger = KumoDialog.Trigger;
export const AlertDialogPortal = BaseDialog.Portal;

export const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof BaseDialog.Backdrop>,
  React.ComponentPropsWithoutRef<typeof BaseDialog.Backdrop>
>(({ className, ...props }, ref) => (
  <BaseDialog.Backdrop
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-kumo-overlay/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
AlertDialogOverlay.displayName = "AlertDialogOverlay";

export const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof BaseDialog.Popup>,
  React.ComponentPropsWithoutRef<typeof BaseDialog.Popup>
>(({ className, ...props }, ref) => (
  <BaseDialog.Portal>
    <AlertDialogOverlay />
    <BaseDialog.Popup
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 bg-kumo-base p-6 shadow-lg ring ring-kumo-line sm:rounded-lg",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        className,
      )}
      {...props}
    />
  </BaseDialog.Portal>
));
AlertDialogContent.displayName = "AlertDialogContent";

export const AlertDialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left",
      className,
    )}
    {...props}
  />
);
AlertDialogHeader.displayName = "AlertDialogHeader";

export const AlertDialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className,
    )}
    {...props}
  />
);
AlertDialogFooter.displayName = "AlertDialogFooter";

export const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof BaseDialog.Title>,
  React.ComponentPropsWithoutRef<typeof BaseDialog.Title>
>(({ className, ...props }, ref) => (
  <BaseDialog.Title
    ref={ref}
    className={cn("text-lg font-semibold", className)}
    {...props}
  />
));
AlertDialogTitle.displayName = "AlertDialogTitle";

export const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof BaseDialog.Description>,
  React.ComponentPropsWithoutRef<typeof BaseDialog.Description>
>(({ className, ...props }, ref) => (
  <BaseDialog.Description
    ref={ref}
    className={cn("text-sm text-kumo-subtle", className)}
    {...props}
  />
));
AlertDialogDescription.displayName = "AlertDialogDescription";

/**
 * AlertDialogAction — primary action button. Phase 06 used `buttonVariants()`
 * to style. Kumo/Base UI's Dialog.Close is the dismiss trigger; we layer
 * button styling via className.
 */
export const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof BaseDialog.Close>,
  React.ComponentPropsWithoutRef<typeof BaseDialog.Close>
>(({ className, ...props }, ref) => (
  <BaseDialog.Close
    ref={ref}
    className={cn(buttonVariants({ variant: "default" }), className)}
    {...props}
  />
));
AlertDialogAction.displayName = "AlertDialogAction";

export const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof BaseDialog.Close>,
  React.ComponentPropsWithoutRef<typeof BaseDialog.Close>
>(({ className, ...props }, ref) => (
  <BaseDialog.Close
    ref={ref}
    className={cn(
      buttonVariants({ variant: "outline" }),
      "mt-2 sm:mt-0",
      className,
    )}
    {...props}
  />
));
AlertDialogCancel.displayName = "AlertDialogCancel";
