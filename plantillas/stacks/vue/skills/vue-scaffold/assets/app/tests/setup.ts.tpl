// Desmonta cada componente montado con @vue/test-utils al terminar su test, para que no queden efectos entre tests.
import { afterEach } from "vitest";
import { enableAutoUnmount } from "@vue/test-utils";

enableAutoUnmount(afterEach);
