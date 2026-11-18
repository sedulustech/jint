// File header for a component module.
import React from "react";
import type { FC } from "react";

/** A function component documents itself with the comment above it. */
export function Card({ title }: { title: string }) {
  // a comment inside a component body
  return <div className="card">{title}</div>; // trailing comment after JSX
}
function Plain() {
  return <></>;
}
export const Arrow = () => <span>arrow</span>;
const Typed: FC = ({ children }) => {
  return <section>{/* a JSX comment child */ children}</section>;
};
const Memo = React.memo(function Inner() {
  return <i />;
});
const element = <b>an element binding</b>;
export default function Page() {
  const handler = () => <u />;
  return <Card title="page" />;
}

class Legacy extends React.Component<{ a: number }> {
  state = { open: false };
  componentDidMount() {}
  render() {
    return <div onClick={() => this.setState({ open: true })} />;
  }
}

interface Props { a: number }
type Alias = Props & { b: string };
enum Mode { On }

describe("Card", () => {
  it("renders", () => {
    render(<Card title="t" />);
  });
});

render(<Page />);
