import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "~/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-md)] text-base font-semibold ring-offset-background transition-all duration-[var(--duration-fast)] active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-[hsl(var(--dominant-hover))] hover:shadow-[var(--shadow-glow-amethyst)]",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-[hsl(var(--border-strong))] bg-transparent text-foreground hover:bg-[hsl(var(--bg-subtle))]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "text-[hsl(var(--fg-muted))] hover:bg-[hsl(var(--dominant-soft))] hover:text-[hsl(var(--dominant))]",
        link: "text-primary underline-offset-4 hover:underline",
        jewel:
          "bg-gradient-to-r from-[hsl(var(--celebration-from))] to-[hsl(var(--celebration-to))] text-white font-semibold shadow-[var(--shadow-glow-amethyst)] hover:shadow-[var(--shadow-glow-amethyst)] disabled:saturate-[0.6] [text-shadow:0_1px_0_rgba(0,0,0,0.25)]",
      },
      size: {
        default: "min-h-12 px-4 py-2",
        sm: "h-9 rounded-[var(--radius-md)] px-3",
        lg: "min-h-12 rounded-[var(--radius-md)] px-8",
        icon: "min-h-12 w-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
