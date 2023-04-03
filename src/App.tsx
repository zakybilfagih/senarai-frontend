import { ReactElement, useState } from 'react'
import logo from './logo.svg'
import viteLogo from './vite.svg'
import tailwindLogo from './tailwind.svg'

function App(): ReactElement {
  const [count, setCount] = useState(0)

  return (
    <div className="rounded-xl border border-gray-50 p-20 shadow-xl">
      <header>
        <div className="flex justify-center">
          <img src={viteLogo} className="h-32 w-32" alt="vite logo" />
          <img src={logo} className="h-32 w-32" alt="React logo" />
          <img
            src={tailwindLogo}
            className="h-32 w-32"
            alt="Tailwind CSS logo"
          />
        </div>
        <p>Count: {count}</p>
        <p>
          <label className="block">
            <span className="text-gray-700">Count</span>
            <input
              type="number"
              className="mt-1 block w-full"
              value={count}
              onChange={(e) => {
                setCount(Number(e.target.value))
              }}
            />
          </label>
        </p>
      </header>
    </div>
  )
}

export default App
