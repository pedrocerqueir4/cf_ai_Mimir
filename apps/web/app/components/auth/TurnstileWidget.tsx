import { Turnstile } from "@marsidev/react-turnstile";

interface Props {
  onSuccess: (token: string) => void;
  onError: () => void;
}

export function TurnstileWidget({ onSuccess, onError }: Props) {
  return (
    <Turnstile
      siteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY}
      onSuccess={onSuccess}
      onError={onError}
      options={{ theme: "auto" }}
    />
  );
}
