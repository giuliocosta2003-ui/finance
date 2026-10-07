// src/ui/index.js
// Un solo punto d'ingresso per la libreria: le schermate importano da "../ui",
// non dai singoli file. Cosi' spostare o dividere un componente non obbliga a
// toccare ogni schermata che lo usa.
export { default as Amount } from "./Amount.jsx";
export { default as Sheet } from "./Sheet.jsx";
export { default as DataTable } from "./DataTable.jsx";

export {
  Button,
  IconButton,
  QuickAction,
  Card,
  CardTitle,
  CardHeader,
  CardBody,
  Chip,
  ChoiceRow,
  Badge,
  Tag,
  SegmentedControl,
  Tabs,
  Field,
  Input,
  Select,
  Textarea,
  Checkbox,
  Switch,
  SearchField,
  Skeleton,
  SkeletonRows,
  EmptyState,
  ErrorState,
} from "./primitives.jsx";

export {
  Page,
  PageHeader,
  Toolbar,
  FilterBar,
  Stat,
  StatGrid,
  InlineAlert,
} from "./layout.jsx";

export { Avatar, ListRow, RowGroup } from "./ListRow.jsx";
export { DateRangePicker, CurrencySelector } from "./fields.jsx";
export { ChartFrame, LegendItem } from "./ChartFrame.jsx";
