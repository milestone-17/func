<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAuthStore } from '@/store/modules/auth';
import { useForm, useFormRules } from '@/hooks/common/form';

defineOptions({ name: 'PwdLogin' });

const authStore = useAuthStore();
const { formRef, validate } = useForm();

interface FormModel {
  email: string;
  password: string;
}

const model = ref<FormModel>({
  email: '',
  password: ''
});

const rules = computed<Record<keyof FormModel, App.Global.FormRule[]>>(() => {
  const { formRules } = useFormRules();

  return {
    email: formRules.email,
    password: formRules.pwd
  };
});

async function handleSubmit() {
  await validate();
  await authStore.login(model.value.email, model.value.password);
}
</script>

<template>
  <ElForm ref="formRef" :model="model" :rules="rules" size="large" :show-label="false" @keyup.enter="handleSubmit">
    <ElFormItem prop="email">
      <ElInput v-model="model.email" type="email" placeholder="管理员邮箱" autocomplete="username" />
    </ElFormItem>
    <ElFormItem prop="password">
      <ElInput
        v-model="model.password"
        type="password"
        show-password-on="click"
        placeholder="密码"
        autocomplete="current-password"
      />
    </ElFormItem>
    <ElButton type="primary" size="large" round block :loading="authStore.loginLoading" class="mt-8px" @click="handleSubmit">
      登 录
    </ElButton>
  </ElForm>
</template>

<style scoped></style>
