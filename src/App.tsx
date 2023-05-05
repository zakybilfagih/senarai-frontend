import Editor from './Editor'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Editor />
    </QueryClientProvider>
  )
}

export default App
