import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import {
  Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Heading2,
  Heading3, Quote, Undo, Redo, Pilcrow,
} from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

interface RichTextEditorProps {
  value: string; // HTML
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
}

/**
 * Editor rico baseado em Tiptap. Saída em HTML.
 * Usado pelas seções da proposta — suporta cabeçalhos, negrito, listas, etc.
 */
export function RichTextEditor({
  value, onChange, placeholder = "Comece a escrever…", className, minHeight = "180px",
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Underline,
      Placeholder.configure({ placeholder }),
    ],
    content: value || "",
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none px-3 py-2",
        style: `min-height: ${minHeight}`,
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  // Sincroniza valor externo (quando o user troca seção, por ex.)
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (value !== current) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  if (!editor) return null;

  return (
    <div className={cn("border border-input rounded-md bg-background overflow-hidden", className)}>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Toolbar({ editor }: { editor: any }) {
  return (
    <div className="flex items-center gap-0.5 border-b border-border bg-muted/30 px-1.5 py-1 flex-wrap">
      <Toggle
        size="sm" pressed={editor.isActive("bold")}
        onPressedChange={() => editor.chain().focus().toggleBold().run()}
        aria-label="Negrito"
      ><Bold className="h-3.5 w-3.5" /></Toggle>
      <Toggle
        size="sm" pressed={editor.isActive("italic")}
        onPressedChange={() => editor.chain().focus().toggleItalic().run()}
        aria-label="Itálico"
      ><Italic className="h-3.5 w-3.5" /></Toggle>
      <Toggle
        size="sm" pressed={editor.isActive("underline")}
        onPressedChange={() => editor.chain().focus().toggleUnderline().run()}
        aria-label="Sublinhado"
      ><UnderlineIcon className="h-3.5 w-3.5" /></Toggle>

      <div className="w-px h-5 bg-border mx-1" />

      <Toggle
        size="sm" pressed={editor.isActive("heading", { level: 2 })}
        onPressedChange={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        aria-label="Título 2"
      ><Heading2 className="h-3.5 w-3.5" /></Toggle>
      <Toggle
        size="sm" pressed={editor.isActive("heading", { level: 3 })}
        onPressedChange={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        aria-label="Título 3"
      ><Heading3 className="h-3.5 w-3.5" /></Toggle>
      <Toggle
        size="sm" pressed={editor.isActive("paragraph")}
        onPressedChange={() => editor.chain().focus().setParagraph().run()}
        aria-label="Parágrafo"
      ><Pilcrow className="h-3.5 w-3.5" /></Toggle>

      <div className="w-px h-5 bg-border mx-1" />

      <Toggle
        size="sm" pressed={editor.isActive("bulletList")}
        onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
        aria-label="Lista"
      ><List className="h-3.5 w-3.5" /></Toggle>
      <Toggle
        size="sm" pressed={editor.isActive("orderedList")}
        onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
        aria-label="Lista numerada"
      ><ListOrdered className="h-3.5 w-3.5" /></Toggle>
      <Toggle
        size="sm" pressed={editor.isActive("blockquote")}
        onPressedChange={() => editor.chain().focus().toggleBlockquote().run()}
        aria-label="Citação"
      ><Quote className="h-3.5 w-3.5" /></Toggle>

      <div className="w-px h-5 bg-border mx-1" />

      <Button
        type="button" variant="ghost" size="icon" className="h-7 w-7"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        aria-label="Desfazer"
      ><Undo className="h-3.5 w-3.5" /></Button>
      <Button
        type="button" variant="ghost" size="icon" className="h-7 w-7"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        aria-label="Refazer"
      ><Redo className="h-3.5 w-3.5" /></Button>
    </div>
  );
}
