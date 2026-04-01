import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";

export default function HomePage() {
  return (
    <div className="flex flex-col items-center pt-16 text-center">
      <Card className="w-full">
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <h1 className="text-xl font-semibold text-foreground">
            No content yet
          </h1>
          <p className="max-w-sm text-muted-foreground">
            You haven&apos;t started learning anything yet. Create your first
            roadmap to get started.
          </p>
          <Button className="min-h-12 px-8" disabled>
            Start learning
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
