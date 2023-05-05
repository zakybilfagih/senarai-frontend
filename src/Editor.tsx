import { useEffect } from 'react'
import { useQuill } from 'react-quilljs'
import { useMutation } from '@tanstack/react-query'
import Delta from 'quill-delta'
import createSuggestionBlotForQuillInstance from './lib/quill/SuggestionBlot'
import 'quill/dist/quill.snow.css'
import './Editor.css'
import './lib/quill/QuillSenarAi.css'

export default function Editor() {
  const { quill, quillRef, Quill } = useQuill({
    modules: { toolbar: [] },
    formats: ['ltmatch']
  })

  useEffect(() => {
    if (Quill && !quill) {
      Quill.register(
        'formats/ltmatch',
        createSuggestionBlotForQuillInstance(Quill)
      )
    }
  }, [quill, Quill])

  useEffect(() => {
    if (quill) {
      quill.root.setAttribute('spellcheck', 'false')
    }
  }, [quill])

  const mutation = useMutation({
    mutationFn: ({ text }: { text: string }) =>
      fetch('http://localhost:8000/evaluate-senarai', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({ text })
      })
        .then((response) => response.json())
        .then((payload) => payload.data.results),
    onSuccess(data) {
      data.forEach((ops: { offset: number; deleteCount: number }) => {
        const delta = new Delta().retain(ops.offset).retain(ops.deleteCount, {
          ltmatch: {
            offset: ops.offset,
            length: ops.deleteCount,
            rule: { id: 'random-rule-id' }
          }
        })
        quill?.updateContents(delta)
      })
    }
  })

  return (
    <section style={{ width: 500, height: 300 }}>
      <div ref={quillRef}></div>
      <button
        onClick={() => {
          mutation.mutate({ text: quill?.getText() ?? '' })
        }}
      >
        Get Content
      </button>
    </section>
  )
}
