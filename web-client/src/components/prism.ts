// Ленивый бандл prismjs. Все грамматики импортируются здесь статически, а сам модуль
// подключается только через `import('./prism')` (CodeBlock) — поэтому Rolldown кладёт
// prism + все языки в один отдельный чанк, вне главного бандла (~67 kB экономии на старте).
//
// Порядок импортов = порядок зависимостей грамматик: clike/markup/css — базовые;
// javascript зависит от clike; jsx — от markup+javascript; typescript — от javascript;
// tsx — от jsx+typescript.
import Prism from 'prismjs'
import 'prismjs/components/prism-clike'
import 'prismjs/components/prism-markup' // html/xml
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-yaml'

export default Prism
