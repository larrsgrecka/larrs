"use client";

import { deleteUser } from "./actions";

export function DeleteButton({ id, name }: { id: string; name: string }) {
  return (
    <form
      action={deleteUser}
      onSubmit={(e) => {
        if (!confirm(`¿Eliminar a ${name}?`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="text-xs text-red-500 hover:underline">
        Eliminar usuario
      </button>
    </form>
  );
}
