<template>
  <div style="margin: 12px 12px 0px;">
    <div style="margin-bottom: 12px;">
      <router-link to="/dashboard/aierp" style="font-size: 16px;">进入 AI 进销存演示工作台</router-link>
    </div>
    <index-chart></index-chart>
  </div>
</template>

<script>
  import IndexChart from './IndexChart'

  export default {
    name: "Analysis",
    components: {
      IndexChart
    },
    data() {
      return {

      }
    },
    created() {

    },
    methods: {

    }
  }
</script>