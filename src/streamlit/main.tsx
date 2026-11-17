import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { routes } from "../routes";
import "../styles.css";
import "./streamlit.css";

// 원래 routes 배열의 같은 화면을 사용한다. 템플릿 관리자 화면은 게시하지 않는다.
const router = createMemoryRouter(routes.map(route => route.index ? route : ({ ...route, children: route.children?.filter(child => !child.handle?.owner) })));
createRoot(document.getElementById("root")!).render(<RouterProvider router={router}/>);
