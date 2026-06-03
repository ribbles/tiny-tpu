import { Button } from "@/components/ui/button";

export default function ButtonTest() {
  return (
    <div className="flex flex-wrap gap-3 p-4">
      <Button>Run Simulation</Button>
      <Button variant="outline">Reset</Button>
      <Button variant="secondary">Step</Button>
      <Button variant="ghost">Docs</Button>
    </div>
  );
}
