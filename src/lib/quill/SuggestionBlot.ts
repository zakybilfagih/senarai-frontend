type Rule = {
  id: string
  description: string
}

type MatchesEntity = {
  offset: number
  length: number
  rule: Rule
}

export default function createSuggestionBlotForQuillInstance(Quill: any) {
  const ParentBlot = Quill.import('blots/inline')

  return class SuggestionBlot extends ParentBlot {
    static blotName = 'ltmatch'
    static tagName = ['quill-lt-match']

    static create(match?: MatchesEntity) {
      const node: HTMLElement = super.create()
      if (match) {
        node.setAttribute('data-offset', match.offset.toString())
        node.setAttribute('data-length', match.length.toString())
        node.setAttribute('data-rule-id', match.rule.id)
      }
      node.addEventListener('click', (event) => {
        console.log(match)
      })
      return node
    }

    optimize() {
      return
    }

    deleteAt() {
      return false
    }
  }
}
