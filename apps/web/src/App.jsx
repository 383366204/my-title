import WorkflowStudio from './WorkflowStudio.jsx';
import './App.css';

export default function App() {
  return (
    <main className="app-shell app-shell-no-sidebar">
      <div className="studio-host">
        <WorkflowStudio />
      </div>
    </main>
  );
}
