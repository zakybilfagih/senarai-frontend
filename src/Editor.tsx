import { useEffect } from 'react'
import { useQuill } from 'react-quilljs'
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
    console.log(Delta)
  }, [])

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

  return (
    <section style={{ width: 500, height: 300 }}>
      <div ref={quillRef}></div>
    </section>
  )
}
