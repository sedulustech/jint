import { useState } from "react";

// Component doc comment.
export function Counter({ start }: { start: number }) {
  const [count, setCount] = useState(start);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}

const Helper = () => <span>hi</span>;
