import { Card, CardContent } from "~/components/ui/card";

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
}

export function StatCard({ label, value, icon }: StatCardProps) {
  return (
    <Card className="min-h-12">
      <CardContent className="p-4">
        {icon && <div className="mb-2 text-muted-foreground">{icon}</div>}
        <p className="text-2xl font-semibold leading-none">{value}</p>
        <p className="text-sm text-muted-foreground mt-1">{label}</p>
      </CardContent>
    </Card>
  );
}
