import { useState } from "react";
import { createPortal } from "react-dom";
import type { Dashboard } from "../../../server/src/types";
import { api } from "../api";
import { Icon } from "../Icon";
import type { Actions } from "../dashboard/Dashboard";
import { Fit } from "../dashboard/Fit";
import type { BoxProps } from "../boxprefs";
import type { WidgetModule } from "./types";

// ---------- Att göra (#86): the household's undated to-dos from a todo.* list in Home Assistant (Todoist and others) ----------

const dueText = (due: string) => {
  const d = new Date(`${due}T12:00:00`);
  return `${d.getDate()}/${d.getMonth() + 1}`;
};

/** A small sheet to write a new to-do (the keyboard needs a real input; nothing else on the board has one open). */
function AddSheet({ title, actions, onClose }: { title: string; actions: Actions; onClose: () => void }) {
  const [text, setText] = useState("");
  const save = () => {
    const name = text.trim();
    if (!name) return;
    onClose();
    void actions.run("Lägg till", () => api.todoAdd(name), { done: `"${name}" tillagd`, check: (d) => Boolean(d.todo?.items.some((i) => i.name === name)) });
  };
  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Lägg till i ${title}`} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="row gap">
          <h2 className="grow" style={{ fontSize: 22 }}>
            Lägg till i {title}
          </h2>
          <button className="btn icon" aria-label="Stäng" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <form
          className="row gap"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input className="input grow" autoFocus maxLength={120} placeholder="T.ex. boka sotning" value={text} onChange={(e) => setText(e.target.value)} aria-label="Vad ska göras?" />
          <button className="btn primary" type="submit" disabled={!text.trim()}>
            Lägg till
          </button>
        </form>
        <small className="muted">Hamnar i listan i Home Assistant (och därmed i Todoist eller den app listan kommer från).</small>
      </div>
    </div>,
    document.body,
  );
}

/** The list: tap a to-do to tick it off, "+ Lägg till" for a new one. `fit` shrinks the text to the box on the new start page. */
export function Todo({ data, actions, box, fit = false }: { data: Dashboard; actions: Actions; box?: BoxProps; fit?: boolean }) {
  const [adding, setAdding] = useState(false);
  const todo = data.todo;
  if (!todo) return null;
  const list = (
    <div className="todo-list">
      {todo.items.length === 0 && <div className="hf-empty">Inget att göra just nu.</div>}
      {todo.items.map((i) => (
        <button
          key={i.id}
          className="todo-item"
          onClick={() => actions.run("Klart", () => api.todoToggle(i.id, true), { done: `"${i.name}" avbockad`, check: (d) => !d.todo?.items.some((x) => x.id === i.id) })}
          aria-label={`Bocka av ${i.name}`}
        >
          <span className="todo-box" aria-hidden="true" />
          <span className="todo-name">{i.name}</span>
          {i.due && <small className="todo-due">{dueText(i.due)}</small>}
        </button>
      ))}
    </div>
  );
  return (
    <section className={`card hf-todo todo-card ${box?.className ?? ""}`} style={box?.style} aria-label={todo.title} {...box?.handlers}>
      {box?.gear}
      <div className="hf-label">
        {todo.title}
        {todo.items.length ? <span> · {todo.items.length}</span> : null}
      </div>
      {fit ? (
        <Fit className="hf-fit" deps={[data]} base={box?.base}>
          {list}
        </Fit>
      ) : (
        list
      )}
      <button className="btn small todo-add" onClick={() => setAdding(true)}>
        <Icon name="plus" size={16} /> Lägg till
      </button>
      {adding && <AddSheet title={todo.title} actions={actions} onClose={() => setAdding(false)} />}
    </section>
  );
}

const widget: WidgetModule = {
  id: "todo",
  label: "Att göra – lista från Home Assistant",
  size: (data) => (data.todo ? 2 + Math.ceil(Math.min(8, data.todo.items.length) / 2) : 0),
  render: ({ data, actions }) => <Todo data={data} actions={actions} />,
};
export default widget;
