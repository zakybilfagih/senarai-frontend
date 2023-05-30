import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useQuill } from 'react-quilljs'
import {
  useFloating,
  inline,
  autoUpdate,
  FloatingFocusManager
} from '@floating-ui/react'
import { useMutation } from '@tanstack/react-query'
import Delta from 'quill-delta'
import createSuggestionBlotForQuillInstance from './lib/quill/SuggestionBlot'
import 'quill/dist/quill.snow.css'
import './Editor.css'
import './lib/quill/QuillSenarAi.css'
import Quill from 'quill'
import useDebouncedCallback from './lib/use-debounce/use-debounced-callback'
import * as Toast from '@radix-ui/react-toast'

export const suggestionType = {
  Mispell: 0,
  Capitalization: 1
} as const

function fetchSpellcheckResponse(text: string) {
  function fetchMispell() {
    return fetch('http://localhost:8000/evaluate-senarai', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ text })
    })
      .then((response) => response.json())
      .then((payload) => payload.data.results)
      .then((results) =>
        results.map((suggestion) => ({
          ...suggestion,
          type: suggestionType.Mispell
        }))
      )
  }

  function fetchCapitalization() {
    return fetch('http://localhost:8080/capitalization_error_correction/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ messages: text })
    })
      .then((response) => response.json())
      .then((payload) => payload.result)
      .then((results) =>
        results.map((suggestion) => ({
          ...suggestion,
          type: suggestionType.Capitalization
        }))
      )
  }

  return Promise.all([fetchMispell(), fetchCapitalization()]).then((value) =>
    value.flat()
  )
}

function removeHighlight(quill) {
  const deltas = quill.getContents()

  const deltasWithoutSelection = deltas.ops.map((delta) => {
    if (delta.attributes && delta.attributes.ltmatch) {
      return {
        ...delta,
        attributes: {
          ...delta.attributes,
          ltmatch: null
        }
      }
    }
    return delta
  })

  return new Delta(deltasWithoutSelection)
}

function highlightCorrection(corrections, activeBlot) {
  return corrections
    .map(({ offset, deleteCount: length, type }) =>
      new Delta().retain(offset).retain(length, {
        ltmatch: {
          offset,
          length,
          active:
            !!activeBlot &&
            activeBlot.length == length &&
            activeBlot.offset == offset &&
            activeBlot.type == type,
          type
        }
      })
    )
    .reduce((prev, value) => prev.compose(value))
}

function useCheckSpellingOnChange(quillInstance, mutateFn, setCorrections) {
  const textChangeHandler = useDebouncedCallback(
    (_delta, _oldContent, source) => {
      if (source === Quill.sources.USER || source === 'highlight') {
        mutateFn({ text: quillInstance.getText() ?? '' })
      }
    },
    1000
  )

  const rebaseChangeHandler = (delta, _oldContent, source) => {
    if (source === Quill.sources.API) {
      setCorrections((corrections) =>
        corrections
          .map((correction) => {
            const { offset, deleteCount } = correction
            let correctionDelta = new Delta().retain(offset).delete(deleteCount)
            correctionDelta = delta.transform(correctionDelta)

            if (correctionDelta.ops.length == 0) return

            if (correctionDelta.ops.length == 1) {
              correction.offset = 0
              correction.deleteCount = correctionDelta.ops[0].delete
            } else if (correctionDelta.ops.length == 2) {
              correction.offset = correctionDelta.ops[0].retain
              correction.deleteCount = correctionDelta.ops[1].delete
            }
            return correction
          })
          .filter(Boolean)
      )
    }
  }

  useEffect(() => {
    if (quillInstance) {
      quillInstance?.on('text-change', textChangeHandler)
      quillInstance?.on('text-change', rebaseChangeHandler)
    }

    return () => {
      quillInstance?.off('text-change', textChangeHandler)
      quillInstance?.off('text-change', rebaseChangeHandler)
    }
  }, [quillInstance])
}

function getOffsetPosition(element, offset = 45, parent = document.body) {
  if (!element) return null

  const bodyRect = parent.getBoundingClientRect().top
  const elemRect = element.getBoundingClientRect().top
  const elemPosition = elemRect - bodyRect
  const offsetPosition = elemPosition - offset

  return offsetPosition
}

function isInDictionary(value, type, dictionary) {
  let key
  switch (type) {
    case suggestionType.Capitalization:
      key = `${value}:${type}`
      break
    case suggestionType.Mispell:
      key = `${value.toLowerCase()}:${type}`
      break
    default:
      break
  }

  return !!dictionary[key ?? '']
}

export default function Editor() {
  const [dictionary, setDictionary] = useState({})
  const [corrections, setCorrections] = useState([])
  const [ignore, setIgnore] = useState({})
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
    mutationFn: ({ text }: { text: string }) => fetchSpellcheckResponse(text),
    onSuccess(data) {
      for (let i = 0; i !== data.length; i++) {
        if (data[i].type == suggestionType.Capitalization) {
          data[i].replacement = [data[i].replacement]
        }

        data[i].selectedReplacement = data[i].replacement.length > 0 ? 0 : null
        data[i].replacement = data[i].replacement.slice(0, 5)
      }

      data.sort((a, b) => {
        const diff = a.offset - b.offset
        if (diff == 0) {
          return a.type - b.type
        }
        return diff
      })

      const rangeFound: Record<string, boolean> = {}
      setCorrections(
        data.filter((value) => {
          const key = `${value.offset},${value.deleteCount}`
          if (rangeFound[key]) {
            return false
          } else {
            const from = quill?.getText(value.offset, value.deleteCount)
            if (
              !isInDictionary(from, value.type, dictionary) &&
              !ignore[
                `${value.offset},${value.deleteCount}:${from?.toLowerCase()}:${
                  value.type
                }`
              ]
            ) {
              rangeFound[key] = true
            }
            return true
          }
        })
      )
    },
    onError() {
      setCorrections([])
    }
  })

  useCheckSpellingOnChange(quill, mutation.mutate, setCorrections)

  const filteredCorrections = useMemo(
    () =>
      corrections
        .map((value) => ({
          ...value,
          from: quill?.getText(value.offset, value.deleteCount)
        }))
        .filter(({ offset, deleteCount, type, from }) => {
          if (from == suggestionType.Mispell) {
            from = from.toLowerCase()
          }

          return !ignore[`${offset},${deleteCount}:${from}:${type}`]
        })
        .filter(({ offset, deleteCount, type, from }) => {
          if (from == suggestionType.Mispell) {
            from = from.toLowerCase()
          }

          return dictionary[`${from}:${type}`] == undefined
        }),
    [corrections, dictionary, ignore]
  )

  const [activeBlot, setActiveBlot] = useState<{
    offset: number
    length: number
    type: number
  } | null>(null)

  const [closed, setClosed] = useState(true)

  useEffect(() => {
    if (filteredCorrections.length > 0) {
      const initialSelection = quill?.getSelection()

      let allDelta = quill?.getContents().diff(removeHighlight(quill))
      const highlights = highlightCorrection(filteredCorrections, activeBlot)
      allDelta = allDelta?.compose(highlights)

      quill?.updateContents(allDelta, 'highlight')

      if (initialSelection) {
        quill?.setSelection(initialSelection)
      }
    }
  }, [filteredCorrections, activeBlot])

  const [openToast, setOpenToast] = useState(false)
  const [toastMessage, setToastMessage] = useState('')

  const setOpenToastWithMessage = useCallback(
    (message: string) => {
      setOpenToast(true)
      setToastMessage(message)
    },
    [setOpenToast, setToastMessage]
  )

  useEffect(() => {
    const activeBlotHandler = ({ detail }) => {
      setActiveBlot(detail)
    }

    document.addEventListener('active-blot', activeBlotHandler)
    return () => {
      document.removeEventListener('active-blot', activeBlotHandler)
    }
  }, [])

  const [activeBlotElement, setActiveBlotElement] =
    useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    setTimeout(() => {
      const el = document.querySelector(
        `quill-lt-match[data-offset="${activeBlot?.offset}"][data-length="${activeBlot?.length}"][data-type="${activeBlot?.type}"][data-active="true"]`
      )
      if (el) {
        setActiveBlotElement(el)
      }
    })
  }, [activeBlot, filteredCorrections])

  const activeBlotPosition = useMemo(
    () => getOffsetPosition(activeBlotElement),
    [activeBlotElement]
  )

  const selectedSuggestion = useMemo(
    () =>
      filteredCorrections.find(
        (correction) =>
          correction.offset == activeBlot?.offset &&
          correction.deleteCount == activeBlot?.length &&
          correction.type == activeBlot?.type
      ),
    [activeBlot]
  )

  const editorContainerRef = useRef<HTMLDivElement>(null)
  const [editorContainerHeight, setEditorContainerHeight] = useState(
    () => editorContainerRef.current?.clientHeight
  )
  const setEditorContainerHeightDebounced = useDebouncedCallback(
    setEditorContainerHeight,
    500
  )
  useEffect(() => {
    if (!editorContainerRef.current) return
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length > 0) {
        setEditorContainerHeightDebounced(entries[0].contentRect.height)
      }
    })
    resizeObserver.observe(editorContainerRef.current)
    return () => resizeObserver.disconnect()
  }, [editorContainerRef.current])

  const [openTooltip, setOpenTooltip] = useState(false)

  return (
    <Toast.Provider swipeDirection="right" duration={5000}>
      <SuggestionTooltip
        anchor={activeBlotElement}
        selectedSuggestion={selectedSuggestion}
        isOpen={openTooltip}
        setIsOpen={setOpenTooltip}
      />
      <main
        className="relative flex min-h-screen flex-row overflow-hidden"
        style={{
          backgroundColor: 'rgb(249, 251, 253)'
        }}
      >
        <div className="flex-grow lg:mb-20 lg:pt-10" ref={editorContainerRef}>
          <section
            className="m-auto h-full bg-white lg:h-min lg:w-5/6 xl:w-3/4 xl:max-w-4xl"
            style={{
              boxShadow: '0 1px 3px 1px rgba(60,64,67,.15)',
              outline: '1px solid transparent',
              marginRight: closed ? undefined : '40px'
            }}
          >
            <div ref={quillRef} className="flex min-h-screen flex-col"></div>
          </section>
        </div>

        <button
          className="absolute right-0 mr-2 rounded-full border-2 border-gray-400 bg-gray-200 px-4 py-2 font-semibold lg:top-5"
          onClick={() => setClosed(false)}
          style={{
            display: closed ? undefined : 'none'
          }}
        >
          Show Suggestions
        </button>

        <SuggestionSidebar
          height={editorContainerHeight}
          setActiveBlot={setActiveBlot}
          activeBlotPosition={activeBlotPosition}
          activeBlot={activeBlot}
          quill={quill}
          filteredCorrections={filteredCorrections}
          setCorrections={setCorrections}
          setDictionary={setDictionary}
          setIgnore={setIgnore}
          closed={closed}
          setClosed={setClosed}
          setOpenToastWithMessage={setOpenToastWithMessage}
        />
      </main>

      <Toast.Root
        className="data-[state=open]:animate-slideIn data-[state=closed]:animate-hide data-[swipe=end]:animate-swipeOut grid grid-cols-[auto_max-content] items-center gap-x-[15px] rounded-md bg-white p-[15px] shadow-[hsl(206_22%_7%_/_35%)_0px_10px_38px_-10px,_hsl(206_22%_7%_/_20%)_0px_10px_20px_-15px] [grid-template-areas:_'title_action'_'description_action'] data-[swipe=cancel]:translate-x-0 data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=cancel]:transition-[transform_200ms_ease-out]"
        open={openToast}
        onOpenChange={setOpenToast}
      >
        <Toast.Title className="mb-[5px] text-[15px] font-medium text-slate-950 [grid-area:_title]">
          {toastMessage}
        </Toast.Title>
      </Toast.Root>
      <Toast.Viewport className="fixed bottom-0 right-0 z-[2147483647] m-0 flex w-[390px] max-w-[100vw] list-none flex-col gap-[10px] p-[var(--viewport-padding)] outline-none [--viewport-padding:_25px]" />
    </Toast.Provider>
  )
}

function SuggestionSidebar({
  quill,
  filteredCorrections,
  setCorrections,
  setDictionary,
  setIgnore,
  setActiveBlot,
  activeBlot,
  activeBlotPosition,
  height,
  closed,
  setClosed,
  setOpenToastWithMessage
}) {
  const sidebarRef = useRef<HTMLDivElement>(null)
  const [activeCard, setActiveCard] = useState<HTMLLIElement | null>(null)

  const transformOffset = useMemo(
    () =>
      activeBlotPosition < (sidebarRef.current?.offsetTop ?? 0)
        ? -(activeCard?.offsetTop ?? 0)
        : -(activeCard?.offsetTop ?? 0) +
          activeBlotPosition -
          (sidebarRef.current?.offsetTop ?? 0),
    [height, activeCard, activeBlot]
  )

  return (
    <section
      className="flex max-w-[350px] flex-grow flex-col bg-gray-200 shadow-md lg:p-5"
      style={{
        display: closed ? 'none' : undefined
      }}
    >
      <button
        className="mb-5 self-end rounded-full bg-gray-100 px-4 py-2 font-semibold"
        onClick={() => setClosed(true)}
      >
        Hide Suggestions
      </button>
      <h3 className="mb-5 w-full text-center font-semibold">
        {filteredCorrections.length > 0
          ? `${filteredCorrections.length} suggestions found`
          : 'No suggestions'}
      </h3>
      <div
        className="overflow-hidden"
        ref={sidebarRef}
        style={{
          height: '100%'
        }}
      >
        <ul
          className="relative flex flex-col gap-3 transition-transform duration-500"
          style={{
            transform: activeCard
              ? `translateY(${transformOffset}px)`
              : 'initial'
          }}
        >
          {filteredCorrections.map(
            ({
              replacement,
              offset,
              deleteCount,
              selectedReplacement,
              type,
              from
            }) => {
              const isActiveBlot =
                activeBlot?.offset == offset &&
                activeBlot?.length == deleteCount &&
                activeBlot?.type == type
              return (
                <CorrectionCard
                  key={`${offset},${deleteCount}:${type}`}
                  active={isActiveBlot}
                  ref={isActiveBlot ? setActiveCard : undefined}
                  from={from}
                  type={type}
                  selectedReplacement={selectedReplacement}
                  replacement={replacement}
                  handleSelectReplacement={(index) => {
                    setCorrections((corrections) =>
                      corrections.map((correction) => {
                        if (
                          correction.offset == offset &&
                          correction.deleteCount == deleteCount &&
                          correction.type == type
                        ) {
                          correction.selectedReplacement = index
                        }
                        return correction
                      })
                    )
                  }}
                  handleAcceptReplacement={() => {
                    const initialSelection = quill?.getSelection()
                    quill?.updateContents(
                      new Delta()
                        .retain(offset)
                        .delete(deleteCount)
                        .insert(replacement[selectedReplacement])
                    )
                    if (initialSelection) {
                      quill?.setSelection(initialSelection)
                    }
                    setActiveBlot(null)
                    setOpenToastWithMessage(
                      `Replaced "${from}" with "${replacement[selectedReplacement]}"`
                    )
                  }}
                  handleAddToDictionary={() => {
                    setDictionary((value) => {
                      let text: string = from
                      if (type == suggestionType.Mispell) {
                        text = text.toLowerCase()
                      }

                      return {
                        ...value,
                        [`${text}:${type}`]: true
                      }
                    })
                    setActiveBlot(null)
                    setOpenToastWithMessage(`Added "${from}" to dictionary`)
                  }}
                  handleIgnore={() => {
                    setIgnore((value) => {
                      let text: string = from
                      if (type == suggestionType.Mispell) {
                        text = text.toLowerCase()
                      }

                      return {
                        ...value,
                        [`${offset},${deleteCount}:${from}:${type}`]: true
                      }
                    })
                    setOpenToastWithMessage(
                      `Ignored currently selected suggestion`
                    )
                  }}
                  handleActiveBlot={() => {
                    if (!isActiveBlot) {
                      setActiveBlot({ offset, length: deleteCount, type })
                    }
                  }}
                />
              )
            }
          )}
        </ul>
      </div>
    </section>
  )
}

const errorMessage = {
  [suggestionType.Mispell]: 'Mispell',
  [suggestionType.Capitalization]: 'Capitalization'
}

const errorColor = {
  [suggestionType.Mispell]: '#ff6a6a',
  [suggestionType.Capitalization]: '#ecf006'
}

const CorrectionCard = forwardRef(
  (
    {
      from,
      type,
      replacement,
      selectedReplacement,
      handleSelectReplacement,
      handleAcceptReplacement,
      handleAddToDictionary,
      handleIgnore,
      handleActiveBlot,
      active
    },
    ref
  ) => {
    if (!active) {
      return (
        <li
          ref={ref}
          onClick={function () {
            handleActiveBlot(this)
          }}
          className="cursor-pointer rounded-md rounded-t-none bg-slate-300 p-4"
          style={{
            boxShadow: `inset 0px 4px 0px 0px ${errorColor[type.toString()]}`
          }}
        >
          <span className="font-semibold uppercase">
            {errorMessage[type.toString()]} Error
          </span>{' '}
          → {from}
        </li>
      )
    }

    const referenceLink = suggestionType.Mispell
      ? 'https://ejaan.kemdikbud.go.id/'
      : 'https://ejaan.kemdikbud.go.id/eyd/penggunaan-huruf/huruf-kapital/'

    const correctionPrompt =
      replacement.length > 0 ? (
        <>
          →{' '}
          <select
            defaultValue={selectedReplacement}
            name="quill-replacement"
            onChange={(event) =>
              handleSelectReplacement(Number(event.target.value))
            }
          >
            {replacement.map((item, index) => (
              <option value={index} key={index}>
                {item}
              </option>
            ))}
          </select>
        </>
      ) : (
        <>not found </>
      )

    return (
      <li
        ref={ref}
        onClick={function () {
          handleActiveBlot(this)
        }}
        style={{
          cursor: active ? 'initial' : 'pointer',
          boxShadow: `inset 0px 4px 0px 0px ${errorColor[type.toString()]}`
        }}
        className="flex flex-col rounded-md rounded-t-none bg-gray-300 p-4"
      >
        <span className="mb-3 text-sm font-semibold uppercase">
          {errorMessage[type.toString()]} Error
        </span>
        <div className="mb-4">
          <span>"{from}"</span> {correctionPrompt}
        </div>
        <div className="flex justify-between">
          <div className="flex content-center gap-2">
            <button
              onClick={() => handleAddToDictionary(from)}
              title="Add to dictionary"
              className="flex gap-1"
            >
              <BookOpenIcon className="h-6 w-6" />
            </button>

            {referenceLink && (
              <a
                href={referenceLink}
                target="_blank"
                className="rounded-sm bg-gray-100 px-2 py-1 text-sm uppercase text-blue-600 hover:bg-gray-200"
              >
                KBBI Reference
              </a>
            )}
          </div>

          {replacement.length > 0 && (
            <div className="flex gap-1">
              <button title="Ignore suggestion" onClick={() => handleIgnore()}>
                <XCircleIcon className="h-6 w-6" />
              </button>
              <button
                onClick={() => handleAcceptReplacement()}
                title="Accept suggestion"
              >
                <CheckCircleIcon className="h-6 w-6" />
              </button>
            </div>
          )}
        </div>
      </li>
    )
  }
)

function CheckCircleIcon(props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

function XCircleIcon(props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

function BookOpenIcon(props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
      />
    </svg>
  )
}

function SuggestionTooltip({ anchor, selectedSuggestion, isOpen, setIsOpen }) {
  if (!selectedSuggestion) return null

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'bottom-start',
    elements: {
      reference: anchor
    },
    middleware: [inline()],
    whileElementsMounted: autoUpdate
  })

  return (
    <FloatingFocusManager modal={false} context={context}>
      <div
        ref={refs.setFloating}
        style={{ ...floatingStyles, borderWidth: '1px' }}
        className="z-10 rounded-md border-gray-200 bg-white shadow-md"
      >
        <ul className="flex flex-col">
          {selectedSuggestion.replacement.map((item, index) => (
            <li
              key={index}
              className="px-2 first:pt-2 last:pb-2 [&:not(:first-child):not(:last-child)]:py-1"
            >
              {item}
            </li>
          ))}
        </ul>
      </div>
    </FloatingFocusManager>
  )
}
