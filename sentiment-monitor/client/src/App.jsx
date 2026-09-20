import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import ProjectList from './pages/ProjectList';
import ProjectDetail from './pages/ProjectDetail';
import Decisions from './pages/Decisions';
import Config from './pages/Config';
import CollectionDetail from './pages/CollectionDetail';
import Summary from './pages/Summary';
import Logs from './pages/Logs';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="projects" element={<ProjectList />} />
          <Route path="projects/:id" element={<ProjectDetail />} />
          <Route path="decisions" element={<Decisions />} />
          <Route path="config" element={<Config />} />
          <Route path="collection/:id" element={<CollectionDetail />} />
          <Route path="summary" element={<Summary />} />
          <Route path="logs" element={<Logs />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
