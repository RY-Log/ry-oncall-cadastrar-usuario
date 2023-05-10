import { validate } from 'email-validator';
import { getAuth } from 'firebase-admin/auth';
import { region } from 'firebase-functions/v1';
import { initializeApp } from 'firebase-admin/app';
import { HttpsError } from 'firebase-functions/v1/https';
import { error as logError } from 'firebase-functions/logger';
import { DocumentReference, getFirestore } from 'firebase-admin/firestore';

const appAdmin = initializeApp();
const authAdmin = getAuth(appAdmin);
const firestore = getFirestore(appAdmin);

enum TipoPessoa {
    FISICA = 'FISICA',
    JURIDICA = 'JURIDICA'
}

interface UserPayload {
    name: string;
    email: string;
    phone?: string;
    password: string;
    isClient: boolean;
    document?: string;
    isWebAdmin: boolean;
    addressRef?: string;
    isDeliveryman: boolean;
    personType?: TipoPessoa;
    license_number?: string;
    car_number_plate?: string;
}

interface UserPersistence {
    nome: string;
    email: string;
    admin: boolean;
    cliente: boolean;
    cnh: string | null;
    entregador: boolean;
    celular: string | null;
    documento: string | null;
    placa_carro: string | null;
    tipo_pessoa: TipoPessoa | null;
    endereco_ref: DocumentReference | null;
}

async function validateEmail(email: string, fn: () => Array<string>) {
    if (validate(email.trim())) {
        try {
            const userRecord = await authAdmin.getUserByEmail(email.trim());
            if (userRecord && userRecord.uid) {
                fn().push('E-mail do usuário já cadastrado.');
            }
        } catch (err) {
            //E-mail não cadastrado, ok.
        }
    } else {
        fn().push(`E-mail do usuário é inválido (${email}).`);
    }
}

async function validatePayload(userPayload: UserPayload, fn: () => Array<string>): Promise<boolean> {
    if (!userPayload.name) {
        fn().push('O nome do usuário precisa ser informado.');
    }
    if (!userPayload.phone) {
        fn().push('O celular do usuário precisa ser informado.');
    }
    if (userPayload.email) {
        await validateEmail(userPayload.email, fn);
    } else {
        fn().push('O e-mail do novo usuário precisa ser informado.');
    }
    return fn().length === 0;
}

function leftPad(value: string, totalWidth: number, paddingChar: string): string {
    if (value.length < totalWidth) {
        const length = totalWidth - value.length + 1;
        return Array(length).join(paddingChar) + value;
    }
    return value;
}

function getNumbers(valor: string): string {
    if (valor) {
        return valor.replace(/\D/g, '');
    }
    return '';
}

function formatarCPF_CNPJ(documento: string): string {
    if (documento) {
        if (getNumbers(documento).length > 11) {
            return leftPad(getNumbers(documento), 14, '0').replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/g, '\$1.\$2.\$3\/\$4\-\$5');
        } else {
            return leftPad(getNumbers(documento), 11, '0').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/g, '\$1.\$2.\$3\-\$4');
        }
    }
    return '';
}

export const oncall_cadastrar_usuario = region('southamerica-east1').https.onCall(async (data: { user_payload: UserPayload }, context) => {
    if (!context.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    const validations = new Array<string>();
    if (!await validatePayload(data?.user_payload ?? {}, () => validations)) {
        logError({
            data: data,
            validations: validations
        });
        throw new HttpsError('failed-precondition', 'Request data not sent.', validations);
    }
    const userRecord = await authAdmin.createUser({
        email: data.user_payload.email.trim().toLowerCase(),
        emailVerified: data.user_payload.password ? true : false,
        password: data.user_payload.password ?? 'Akkds@17986#-FYd'
    });
    const usuarioPersistir: UserPersistence = {
        email: data.user_payload.email,
        nome: data.user_payload.name ?? null,
        celular: data.user_payload.phone ?? null,
        admin: data.user_payload.isWebAdmin ?? false,
        cliente: data.user_payload.isClient ?? false,
        cnh: data.user_payload.license_number ?? null,
        entregador: data.user_payload.isDeliveryman ?? false,
        placa_carro: data.user_payload.car_number_plate ?? null,
        tipo_pessoa: data.user_payload.personType ?? TipoPessoa.FISICA,
        documento: data.user_payload.document ? formatarCPF_CNPJ(data.user_payload.document) : null,
        endereco_ref: data.user_payload.addressRef ? firestore.doc(data.user_payload.addressRef) : null
    }
    await firestore.collection('usuarios').doc(userRecord.uid).set(usuarioPersistir);
    return {
        uid: userRecord.uid
    }
});