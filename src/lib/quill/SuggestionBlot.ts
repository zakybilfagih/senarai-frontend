import { suggestionType } from '../../Editor'
import html from 'nanohtml/lib/browser'

type MatchesEntity = {
  offset: number
  length: number
  replacement: string[]
  selectedReplacement: number | null
  active: boolean
  type: (typeof suggestionType)[keyof typeof suggestionType]
}

export default function createSuggestionBlotForQuillInstance(Quill: any) {
  const ParentBlot = Quill.import('blots/inline')
  const Delta = Quill.imports.delta

  function findQuill(node): Quill {
    while (node) {
      const quill = Quill.find(node)
      if (quill instanceof Quill) return quill
      node = node.parentElement
    }
  }

  return class SuggestionBlot extends ParentBlot {
    static blotName = 'ltmatch'
    static tagName = ['quill-lt-match']

    static create(match?: MatchesEntity) {
      const node: HTMLElement = super.create()
      if (match && match.offset != null) {
        const { length, offset, active, type } = match
        node.setAttribute('data-offset', offset.toString())
        node.setAttribute('data-length', length.toString())
        node.setAttribute('data-type', type.toString())
        if (active) {
          node.setAttribute('data-active', 'true')
        }
        node.addEventListener('click', (event) => {
          if (active) return

          document.dispatchEvent(
            new CustomEvent('active-blot', {
              detail: {
                offset,
                length,
                type
              }
            })
          )
        })
      }
      return node
    }

    optimize(context) {
      if (this.next instanceof SuggestionBlot) {
        const thisType =
          this.domNode?.attributes?.getNamedItem('data-type')?.value
        const thatType =
          this.next.domNode?.attributes?.getNamedItem('data-type')?.value

        if (thisType == thatType) {
          super.optimize(context)
        }
      }
    }
  }
}
