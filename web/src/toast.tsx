import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Toast } from '@base-ui/react/toast';
import { Tip } from './components/ui';
import { createContext, useCallback, useContext, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

const ToastContext = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

// A yes/no question in a dialog. Resolves true on Yes, false on No, Esc or a click outside.
const ConfirmContext = createContext<(message: string) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmContext);

function ToastList() {
    const { toasts } = Toast.useToastManager();
    return toasts.map((t) => (
        <Toast.Root key={t.id} toast={t} className="toast">
            <Toast.Title />
            <Toast.Close className="toast-close" aria-label="Dismiss">×</Toast.Close>
        </Toast.Root>
    ));
}

// Provides toasts and confirm dialogs to the whole page.
export function ToastProvider({ children }: { children: ReactNode }) {
    return (
        <Toast.Provider timeout={6000} limit={1}>
            <Confirms>{children}</Confirms>
            <Toast.Portal><Toast.Viewport className="toast-viewport"><ToastList /></Toast.Viewport></Toast.Portal>
        </Toast.Provider>
    );
}

function Confirms({ children }: { children: ReactNode }) {
    const manager = Toast.useToastManager();
    const show = useCallback((text: string) => { manager.close(); manager.add({ title: text }); }, [manager]);
    const [ask, setAsk] = useState<{ message: string; answer: (yes: boolean) => void } | null>(null);
    const confirm = useCallback((message: string) => new Promise<boolean>((answer) => setAsk({ message, answer })), []);
    const close = (yes: boolean) => { ask?.answer(yes); setAsk(null); };
    return (
        <ToastContext.Provider value={show}>
            <ConfirmContext.Provider value={confirm}>
                {children}
                <AlertDialog.Root open={ask !== null} onOpenChange={(open) => { if (!open) close(false); }}>
                    <AlertDialog.Portal>
                        <AlertDialog.Backdrop className="dialog-backdrop" />
                        <AlertDialog.Popup className="dialog">
                            <AlertDialog.Title className="dialog-title">Are you sure?</AlertDialog.Title>
                            <AlertDialog.Description className="dialog-text">{ask?.message}</AlertDialog.Description>
                            <div className="row">
                                <button type="button" className="primary" onClick={() => close(true)}>Yes</button>
                                <button type="button" className="link" onClick={() => close(false)}>No</button>
                            </div>
                        </AlertDialog.Popup>
                    </AlertDialog.Portal>
                </AlertDialog.Root>
            </ConfirmContext.Provider>
        </ToastContext.Provider>
    );
}

// Runs an action, keeping its control disabled until it settles and toasting the outcome.
export function useAction() {
    const toast = useToast();
    const [busy, setBusy] = useState(false);
    const run = useCallback(async (fn: () => Promise<unknown>, done?: string) => {
        setBusy(true);
        try {
            await fn();
            if (done) toast(done);
            return true;
        } catch (e) {
            toast((e as Error).message);
            return false;
        } finally {
            setBusy(false);
        }
    }, [toast]);
    return { busy, run };
}

type ActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
    action: () => Promise<unknown>;
    done?: string;
    confirm?: string;
};
export function ActionButton({ action, done, confirm, disabled, title, ...rest }: ActionButtonProps) {
    const { busy, run } = useAction();
    const ask = useConfirm();
    return (
        <Tip text={title}>
            <button
                type="button"
                {...rest}
                disabled={busy || disabled}
                onClick={async () => { if (!confirm || await ask(confirm)) run(action, done); }}
            />
        </Tip>
    );
}
